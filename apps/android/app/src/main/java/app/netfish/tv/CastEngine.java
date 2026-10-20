package app.netfish.tv;

import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.mediarouter.media.MediaRouteSelector;
import androidx.mediarouter.media.MediaRouter;

import com.google.android.gms.cast.HlsSegmentFormat;
import com.google.android.gms.cast.HlsVideoSegmentFormat;
import com.google.android.gms.cast.MediaInfo;
import com.google.android.gms.cast.MediaLoadRequestData;
import com.google.android.gms.cast.MediaMetadata;
import com.google.android.gms.cast.MediaSeekOptions;
import com.google.android.gms.cast.MediaStatus;
import com.google.android.gms.cast.MediaTrack;
import com.google.android.gms.cast.framework.CastContext;
import com.google.android.gms.cast.framework.CastSession;
import com.google.android.gms.cast.framework.SessionManagerListener;
import com.google.android.gms.cast.framework.media.RemoteMediaClient;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.common.images.WebImage;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/**
 * Chromecast, on phones and tablets with Google Play services (not Fire TV): finds the
 * Chromecasts on the network, connects to one, and plays a film there on Google's own player
 * (the Default Media Receiver), which the page then drives like its own. The page draws the
 * list of devices; this reports what MediaRouter finds and what the Chromecast is doing, as
 * JSON to window.__netfishCast.
 */
final class CastEngine {
    private static final String TAG = "NetfishCast";

    private final Activity activity;
    private final Consumer<String> push;
    private final Handler main = new Handler(Looper.getMainLooper());
    private CastContext cast;
    private MediaRouter router;
    private MediaRouteSelector selector;
    private boolean watching;
    private RemoteMediaClient client;

    CastEngine(Activity activity, Consumer<String> push) {
        this.activity = activity;
        this.push = push;
    }

    /** Phones and tablets with Google Play services: Fire TV and other TVs have neither, nor need it. */
    static boolean availableOn(Context context) {
        if (context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK)) return false;
        try {
            return GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS;
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** Sets up Cast; false when this device can't (the page then shows no cast button). */
    boolean start() {
        if (!availableOn(activity)) return false;
        try {
            cast = CastContext.getSharedInstance(activity);
        } catch (RuntimeException e) {
            Log.w(TAG, "Cast unavailable: " + e.getMessage());
            return false;
        }
        router = MediaRouter.getInstance(activity);
        selector = cast.getMergedSelector();
        cast.getSessionManager().addSessionManagerListener(sessions, CastSession.class);
        CastSession current = cast.getSessionManager().getCurrentCastSession();
        if (current != null && current.isConnected()) follow(current);
        return true;
    }

    void release() {
        if (cast == null) return;
        if (router != null) router.removeCallback(routes);
        cast.getSessionManager().removeSessionManagerListener(sessions, CastSession.class);
        follow(null);
    }

    // ---------- Finding Chromecasts (only while the page's player is open: it costs battery) ----------

    private final MediaRouter.Callback routes = new MediaRouter.Callback() {
        @Override
        public void onRouteAdded(MediaRouter r, MediaRouter.RouteInfo route) {
            pushDevices();
        }

        @Override
        public void onRouteRemoved(MediaRouter r, MediaRouter.RouteInfo route) {
            pushDevices();
        }

        @Override
        public void onRouteChanged(MediaRouter r, MediaRouter.RouteInfo route) {
            pushDevices();
        }
    };

    void watch(boolean on) {
        main.post(() -> {
            if (router == null || on == watching) return;
            watching = on;
            if (on) router.addCallback(selector, routes, MediaRouter.CALLBACK_FLAG_REQUEST_DISCOVERY);
            else router.removeCallback(routes);
            pushDevices();
        });
    }

    private void pushDevices() {
        if (router == null) return;
        JSONArray list = new JSONArray();
        try {
            for (MediaRouter.RouteInfo route : router.getRoutes()) {
                if (route.isDefault() || !route.isEnabled() || !route.matchesSelector(selector)) continue;
                list.put(new JSONObject().put("id", route.getId()).put("name", route.getName())
                        .put("description", route.getDescription() == null ? "" : route.getDescription()));
            }
            push.accept(new JSONObject().put("devices", list).toString());
        } catch (JSONException ignored) {
        }
    }

    void connect(String id) {
        main.post(() -> {
            if (router == null) return;
            for (MediaRouter.RouteInfo route : router.getRoutes()) {
                if (route.getId().equals(id)) {
                    router.selectRoute(route);
                    return;
                }
            }
            pushError("That device isn't there any more");
        });
    }

    void disconnect() {
        main.post(() -> {
            if (cast != null) cast.getSessionManager().endCurrentSession(true);
        });
    }

    // ---------- The session (connected to one Chromecast) ----------

    private final SessionManagerListener<CastSession> sessions = new SessionManagerListener<CastSession>() {
        @Override
        public void onSessionStarted(CastSession session, String sessionId) {
            follow(session);
        }

        @Override
        public void onSessionResumed(CastSession session, boolean wasSuspended) {
            follow(session);
        }

        @Override
        public void onSessionEnded(CastSession session, int error) {
            follow(null);
        }

        @Override
        public void onSessionStartFailed(CastSession session, int error) {
            pushError("Couldn't connect to the Chromecast");
            follow(null);
        }

        @Override
        public void onSessionStarting(CastSession session) {
        }

        @Override
        public void onSessionEnding(CastSession session) {
        }

        @Override
        public void onSessionResuming(CastSession session, String sessionId) {
        }

        @Override
        public void onSessionResumeFailed(CastSession session, int error) {
        }

        @Override
        public void onSessionSuspended(CastSession session, int reason) {
        }
    };

    private final RemoteMediaClient.Callback status = new RemoteMediaClient.Callback() {
        @Override
        public void onStatusUpdated() {
            pushStatus();
        }
    };

    private final RemoteMediaClient.ProgressListener progress = (position, duration) -> pushStatus();

    private void follow(CastSession session) {
        if (client != null) {
            client.unregisterCallback(status);
            client.removeProgressListener(progress);
        }
        client = session == null ? null : session.getRemoteMediaClient();
        if (client != null) {
            client.registerCallback(status);
            client.addProgressListener(progress, 1000);
        }
        try {
            JSONObject state = new JSONObject().put("connected", session != null && session.isConnected());
            if (session != null && session.getCastDevice() != null) state.put("device", session.getCastDevice().getFriendlyName());
            push.accept(state.toString());
        } catch (JSONException ignored) {
        }
        pushStatus();
    }

    private CastSession session() {
        return cast == null ? null : cast.getSessionManager().getCurrentCastSession();
    }

    /** What the Chromecast is doing: where, how long, paused, waiting, finished, its volume. */
    private void pushStatus() {
        CastSession session = session();
        if (client == null || session == null) return;
        MediaStatus s = client.getMediaStatus();
        if (s == null) return;
        try {
            int state = s.getPlayerState();
            JSONObject json = new JSONObject()
                    .put("time", client.getApproximateStreamPosition() / 1000.0)
                    .put("duration", client.getStreamDuration() / 1000.0)
                    .put("paused", state == MediaStatus.PLAYER_STATE_PAUSED)
                    .put("buffering", state == MediaStatus.PLAYER_STATE_BUFFERING || state == MediaStatus.PLAYER_STATE_LOADING)
                    .put("playing", state == MediaStatus.PLAYER_STATE_PLAYING)
                    .put("volume", session.getVolume())
                    .put("muted", session.isMute());
            // Which film this is about (the page ignores news of the one before).
            if (s.getMediaInfo() != null) json.put("url", s.getMediaInfo().getContentId());
            if (state == MediaStatus.PLAYER_STATE_IDLE) {
                int why = s.getIdleReason();
                if (why == MediaStatus.IDLE_REASON_FINISHED) json.put("ended", true);
                if (why == MediaStatus.IDLE_REASON_ERROR) json.put("error", "The Chromecast couldn't play this");
            }
            push.accept(json.toString());
        } catch (JSONException ignored) {
        }
    }

    private void pushError(String message) {
        pushError(message, 0);
    }

    private void pushError(String message, int code) {
        try {
            JSONObject json = new JSONObject().put("error", message);
            if (code != 0) json.put("errorCode", code);
            push.accept(json.toString());
        } catch (JSONException ignored) {
        }
    }

    // ---------- Playing there ----------

    /**
     * A film on the Chromecast: url (one it can open on its own), contentType, startSeconds,
     * durationSeconds, title, subtitle, image, episode, subtitles [{id, url, label, language}],
     * subtitleId (the one to show, or none).
     */
    void load(String json) {
        main.post(() -> {
            CastSession session = session();
            if (session == null || session.getRemoteMediaClient() == null) {
                pushError("Not connected to a Chromecast");
                return;
            }
            try {
                JSONObject r = new JSONObject(json);
                MediaMetadata meta = new MediaMetadata(r.optBoolean("episode") ? MediaMetadata.MEDIA_TYPE_TV_SHOW : MediaMetadata.MEDIA_TYPE_MOVIE);
                meta.putString(MediaMetadata.KEY_TITLE, r.optString("title"));
                if (!r.optString("subtitle").isEmpty()) meta.putString(MediaMetadata.KEY_SUBTITLE, r.optString("subtitle"));
                if (!r.optString("image").isEmpty()) meta.addImage(new WebImage(Uri.parse(r.optString("image"))));
                List<MediaTrack> tracks = new ArrayList<>();
                JSONArray subs = r.optJSONArray("subtitles");
                for (int i = 0; subs != null && i < subs.length(); i++) {
                    JSONObject t = subs.getJSONObject(i);
                    tracks.add(new MediaTrack.Builder(t.getLong("id"), MediaTrack.TYPE_TEXT)
                            .setSubtype(MediaTrack.SUBTYPE_SUBTITLES)
                            .setContentId(t.getString("url"))
                            .setContentType("text/vtt")
                            .setName(t.optString("label"))
                            .setLanguage(t.optString("language"))
                            .build());
                }
                String url = r.getString("url");
                String type = r.optString("contentType", "video/mp4");
                MediaInfo.Builder media = new MediaInfo.Builder(url)
                        .setContentUrl(url)
                        .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
                        .setContentType(type)
                        .setStreamDuration((long) (r.optDouble("durationSeconds", 0) * 1000))
                        .setMetadata(meta)
                        .setMediaTracks(tracks);
                // Jellyfin's HLS: H.264 and AAC in MPEG-TS segments. Said outright: the Chromecast's
                // player otherwise expects fMP4 segments and gives up on these.
                if (type.toLowerCase().contains("mpegurl")) {
                    media.setHlsSegmentFormat(HlsSegmentFormat.TS).setHlsVideoSegmentFormat(HlsVideoSegmentFormat.MPEG2_TS);
                }
                MediaInfo info = media.build();
                MediaLoadRequestData.Builder request = new MediaLoadRequestData.Builder()
                        .setMediaInfo(info)
                        .setAutoplay(true)
                        .setCurrentTime((long) (r.optDouble("startSeconds", 0) * 1000));
                if (r.has("subtitleId") && !r.isNull("subtitleId")) request.setActiveTrackIds(new long[] {r.getLong("subtitleId")});
                // Refused outright: say so, with the Chromecast's own reason (a number), for a bug report.
                session.getRemoteMediaClient().load(request.build()).setResultCallback(result -> {
                    if (!result.getStatus().isSuccess()) pushError("The Chromecast couldn't play this", result.getStatus().getStatusCode());
                });
            } catch (JSONException e) {
                pushError("Nothing to play");
            }
        });
    }

    /** play, pause, seek (seconds), volume (0–1), mute (true/false), subtitle (its id, or null for none), stop. */
    void command(String name, String valueJson) {
        main.post(() -> {
            CastSession session = session();
            RemoteMediaClient c = session == null ? null : session.getRemoteMediaClient();
            if (c == null) return;
            Object value = null;
            try {
                value = new JSONArray("[" + (valueJson == null ? "null" : valueJson) + "]").get(0);
            } catch (JSONException ignored) {
            }
            try {
                switch (name) {
                    case "play": c.play(); break;
                    case "pause": c.pause(); break;
                    case "seek":
                        if (value instanceof Number) {
                            c.seek(new MediaSeekOptions.Builder().setPosition((long) (((Number) value).doubleValue() * 1000)).build());
                        }
                        break;
                    case "volume":
                        if (value instanceof Number) session.setVolume(Math.max(0, Math.min(1, ((Number) value).doubleValue())));
                        break;
                    case "mute": session.setMute(Boolean.TRUE.equals(value)); break;
                    case "subtitle":
                        c.setActiveMediaTracks(value instanceof Number ? new long[] {((Number) value).longValue()} : new long[0]);
                        break;
                    case "stop": c.stop(); break;
                    default: break;
                }
            } catch (Exception e) {
                Log.w(TAG, name + ": " + e.getMessage());
            }
        });
    }
}
