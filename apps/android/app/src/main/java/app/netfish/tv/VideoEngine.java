package app.netfish.tv;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.CookieManager;

import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.analytics.AnalyticsListener;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.function.Consumer;

/**
 * The film, drawn by ExoPlayer underneath the (transparent) Netfish page, the
 * way the Mac app does it with mpv: Netfish's own player and remote controls
 * on top, the TV's hardware decoding the picture and FFmpeg (inside the app)
 * decoding any sound format, so the server just sends the file. ExoPlayer also
 * draws the subtitles, picture ones included.
 */
@OptIn(markerClass = UnstableApi.class)
final class VideoEngine {
    private static final String TAG = "NetfishPlayer";

    /** Where state changes go (MainActivity hands them to the page). */
    interface StateListener {
        void push(JSONObject state);
    }

    private final Activity activity;
    private final PlayerView view;
    private final StateListener listener;
    private final DefaultHttpDataSource.Factory http;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private ExoPlayer player;
    private JSONObject request;
    private boolean loaded;
    private boolean tracksApplied;
    private boolean active;
    private float volume = 1f;
    private Consumer<Boolean> activeListener = showing -> {};
    private boolean controlsShowing;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            pushTime();
            handler.postDelayed(this, 250);
        }
    };

    VideoEngine(Activity activity, PlayerView view, StateListener listener) {
        this.activity = activity;
        this.view = view;
        this.listener = listener;
        view.setUseController(false); // Netfish's own controls are on the page above
        view.setFocusable(false);
        view.setShutterBackgroundColor(Color.BLACK);
        view.setKeepContentOnPlayerReset(false);
        if (view.getSubtitleView() != null) view.getSubtitleView().setFractionalTextSize(0.058f);
        view.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> placeSubtitles());
        http = new DefaultHttpDataSource.Factory()
                .setUserAgent("NetfishTV/" + BuildConfig.NETFISH_VERSION)
                .setAllowCrossProtocolRedirects(true);
    }

    private ExoPlayer player() {
        if (player != null) return player;
        // Hardware decoders first; FFmpeg for sound the TV can't decode (DTS, TrueHD…).
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(activity)
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
                .setEnableDecoderFallback(true);
        player = new ExoPlayer.Builder(activity, renderers).setMediaSourceFactory(new DefaultMediaSourceFactory(http)).build();
        player.addListener(new Player.Listener() {
            @Override
            public void onTracksChanged(Tracks tracks) {
                if (!tracksApplied && !tracks.isEmpty()) {
                    tracksApplied = true;
                    choosePositions(tracks);
                }
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (!active) return;
                if (state == Player.STATE_BUFFERING) push("paused-for-cache", true);
                if (state == Player.STATE_READY) {
                    if (!loaded) {
                        loaded = true;
                        push(json("loaded", true, "pause", !player.getPlayWhenReady(), "duration", seconds(player.getDuration())));
                    } else {
                        push("paused-for-cache", false);
                    }
                }
                if (state == Player.STATE_ENDED) push(json("ended", true, "finished", true));
            }

            @Override
            public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
                if (active) push("pause", !playWhenReady);
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                Log.w(TAG, "playback failed", error);
                if (active) push(json("ended", true, "error", "The TV couldn't play this (" + error.getErrorCodeName() + ")"));
            }
        });
        player.addAnalyticsListener(new AnalyticsListener() {
            @Override
            public void onAudioDecoderInitialized(EventTime time, String decoderName, long initializedTimestampMs, long initializationDurationMs) {
                Log.i(TAG, "audio decoder: " + decoderName);
            }

            @Override
            public void onVideoDecoderInitialized(EventTime time, String decoderName, long initializedTimestampMs, long initializationDurationMs) {
                Log.i(TAG, "video decoder: " + decoderName);
            }
        });
        view.setPlayer(player);
        return player;
    }

    /** Told when a film starts and stops showing (phones go full screen and sideways). */
    void setActiveListener(Consumer<Boolean> listener) {
        activeListener = listener;
    }

    // ---------- From the page ----------

    void load(JSONObject r) {
        request = r;
        loaded = false;
        tracksApplied = false;
        if (!active) activeListener.accept(true);
        active = true;
        String url = r.optString("url");
        // Same sign-in as the page: its session cookie.
        String cookie = CookieManager.getInstance().getCookie(url);
        http.setDefaultRequestProperties(cookie != null ? Collections.singletonMap("Cookie", cookie) : Collections.emptyMap());

        ExoPlayer p = player();
        p.setTrackSelectionParameters(trackPreferences(p.getTrackSelectionParameters()));
        MediaItem.Builder item = new MediaItem.Builder().setUri(url);
        if (r.optBoolean("isHls")) item.setMimeType(MimeTypes.APPLICATION_M3U8);
        List<MediaItem.SubtitleConfiguration> subtitles = new ArrayList<>();
        JSONArray external = r.optJSONArray("externalSubtitles");
        for (int i = 0; external != null && i < external.length(); i++) {
            JSONObject sub = external.optJSONObject(i);
            if (sub == null) continue;
            subtitles.add(new MediaItem.SubtitleConfiguration.Builder(Uri.parse(sub.optString("url")))
                    .setMimeType(MimeTypes.TEXT_VTT)
                    .setLanguage(sub.optString("language", null))
                    .setLabel(sub.optString("label", null))
                    .setId("external-" + i)
                    .build());
        }
        item.setSubtitleConfigurations(subtitles);
        p.setVolume(volume);
        p.setMediaItem(item.build(), (long) (r.optDouble("startSeconds", 0) * 1000));
        p.prepare();
        p.setPlayWhenReady(true);
        handler.removeCallbacks(tick);
        handler.post(tick);
    }

    void command(String name, Object value) {
        if ("controls".equals(name)) {
            // Netfish's controls are showing: lift the subtitles above them.
            controlsShowing = Boolean.TRUE.equals(value);
            placeSubtitles();
            return;
        }
        ExoPlayer p = player;
        if (p == null) return;
        switch (name) {
            case "play": p.play(); break;
            case "pause": p.pause(); break;
            case "seek":
                if (value instanceof Number) p.seekTo((long) (((Number) value).doubleValue() * 1000));
                break;
            case "volume":
                if (value instanceof Number) {
                    volume = ((Number) value).floatValue();
                    p.setVolume(volume);
                }
                break;
            case "mute": p.setVolume(Boolean.TRUE.equals(value) ? 0f : volume); break;
            case "audio":
                if (value instanceof Number) select(C.TRACK_TYPE_AUDIO, ((Number) value).intValue());
                break;
            case "subtitle":
                if (value instanceof Number) select(C.TRACK_TYPE_TEXT, ((Number) value).intValue());
                else p.setTrackSelectionParameters(p.getTrackSelectionParameters().buildUpon()
                        .clearOverridesOfType(C.TRACK_TYPE_TEXT).setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build());
                break;
            case "stop": stop(); break;
            default: break;
        }
    }

    void stop() {
        if (active) activeListener.accept(false);
        active = false;
        handler.removeCallbacks(tick);
        if (player != null) {
            player.stop();
            player.clearMediaItems();
        }
    }

    void pause() {
        if (player != null) player.pause();
    }

    void release() {
        stop();
        if (player != null) player.release();
        player = null;
    }

    /** Subtitles sit a little above the bottom edge, and well above Netfish's controls while they show. */
    private void placeSubtitles() {
        if (view.getSubtitleView() == null) return;
        int height = view.getHeight();
        view.getSubtitleView().setPadding(0, 0, 0, Math.round(height * (controlsShowing ? 0.2f : 0.06f)));
    }

    // ---------- Tracks ----------

    /** Subtitles off unless Netfish chose some; sound in the chosen language. */
    private TrackSelectionParameters trackPreferences(TrackSelectionParameters current) {
        TrackSelectionParameters.Builder builder = current.buildUpon().clearOverrides();
        JSONObject subtitles = request.optJSONObject("subtitles");
        boolean on = subtitles != null && "on".equals(subtitles.optString("mode"));
        builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, !on);
        if (on && subtitles.has("language")) builder.setPreferredTextLanguage(subtitles.optString("language"));
        JSONObject audio = request.optJSONObject("audio");
        if (audio != null && audio.has("language")) builder.setPreferredAudioLanguage(audio.optString("language"));
        return builder.build();
    }

    /** The exact tracks Netfish chose, by their order in the file, once the file's tracks are known. */
    private void choosePositions(Tracks tracks) {
        JSONObject audio = request.optJSONObject("audio");
        if (audio != null && audio.optInt("position", 0) > 0) select(C.TRACK_TYPE_AUDIO, audio.optInt("position"), tracks);
        JSONObject subtitles = request.optJSONObject("subtitles");
        if (subtitles != null && "on".equals(subtitles.optString("mode")) && subtitles.optInt("position", 0) > 0) {
            select(C.TRACK_TYPE_TEXT, subtitles.optInt("position"), tracks);
        }
    }

    private void select(int type, int position) {
        select(type, position, player.getCurrentTracks());
    }

    private void select(int type, int position, Tracks tracks) {
        int seen = 0;
        for (Tracks.Group group : tracks.getGroups()) {
            if (group.getType() != type || ++seen != position) continue;
            player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                    .setTrackTypeDisabled(type, false)
                    .setOverrideForType(new TrackSelectionOverride(group.getMediaTrackGroup(), 0))
                    .build());
            return;
        }
    }

    // ---------- To the page ----------

    private void pushTime() {
        if (player == null || !active) return;
        JSONObject state = json("time-pos", player.getCurrentPosition() / 1000.0, "demuxer-cache-time", player.getBufferedPosition() / 1000.0);
        long duration = player.getDuration();
        try {
            if (duration != C.TIME_UNSET) state.put("duration", duration / 1000.0);
        } catch (JSONException ignored) {
            // can't happen
        }
        listener.push(state);
    }

    private void push(String key, Object value) {
        listener.push(json(key, value));
    }

    private void push(JSONObject state) {
        listener.push(state);
    }

    private static Object seconds(long ms) {
        return ms == C.TIME_UNSET ? JSONObject.NULL : ms / 1000.0;
    }

    private static JSONObject json(Object... pairs) {
        JSONObject object = new JSONObject();
        try {
            for (int i = 0; i + 1 < pairs.length; i += 2) object.put((String) pairs[i], pairs[i + 1]);
        } catch (JSONException ignored) {
            // can't happen
        }
        return object;
    }
}
