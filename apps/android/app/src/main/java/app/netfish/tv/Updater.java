package app.netfish.tv;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.UUID;

/**
 * Updates from inside the app (phones, tablets and TVs): the newest release's APK from
 * GitHub, handed to Android's installer, which asks you to confirm. Android only accepts it
 * if it's signed like the installed app, so nothing else can replace Netfish this way.
 * The page hears back through window.__netfishUpdate({for: "check" | "install", ...}).
 */
final class Updater {
    static final String ACTION_STATUS = "app.netfish.UPDATE_STATUS";
    private static final String REPOSITORY = "ravifrancesco/netfish";
    private static final String APK = "Netfish-android.apk";

    interface Events {
        void send(String json);
    }

    private final Activity activity;
    private final boolean tv;
    private final Events events;
    /** Downloading (pressing Update again meanwhile does nothing). */
    private volatile boolean busy;
    /** Only the installer's answers about our own install carry it (the activity can be opened by anyone). */
    private volatile String token;

    Updater(Activity activity, boolean tv, Events events) {
        this.activity = activity;
        this.tv = tv;
        this.events = events;
    }

    /** Is there a newer version (the same answer as the desktop apps' check). */
    void check() {
        new Thread(() -> {
            try {
                JSONObject release = latest();
                String latest = release.optString("tag_name").replaceFirst("^v", "");
                JSONObject status = new JSONObject()
                        .put("current", BuildConfig.NETFISH_VERSION)
                        .put("latest", latest)
                        .put("available", newer(latest, BuildConfig.NETFISH_VERSION))
                        .put("canInstall", apkUrl(release) != null && ownBuild())
                        .put("page", release.optString("html_url"));
                send("check", new JSONObject().put("status", status));
            } catch (Exception e) {
                fail("check", activity.getString(R.string.update_cant_check, e.getMessage()));
            }
        }, "netfish-update-check").start();
    }

    /** Downloads the new version and hands it to Android, which asks to confirm (see onStatus). */
    void install() {
        if (busy) return;
        busy = true;
        new Thread(() -> {
            File apk = new File(activity.getCacheDir(), "update.apk");
            try {
                if (!ownBuild()) throw new Problem(activity.getString(R.string.update_not_this_build));
                // Android 8 and later ask once whether Netfish may install apps.
                if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
                    activity.runOnUiThread(this::openInstallSetting);
                    throw new Problem(activity.getString(tv ? R.string.update_allow_tv : R.string.update_allow));
                }
                String url = apkUrl(latest());
                if (url == null) throw new Problem(activity.getString(R.string.update_no_file));
                download(url, apk);
                PackageInfo info = activity.getPackageManager().getPackageArchiveInfo(apk.getPath(), 0);
                if (info == null || !activity.getPackageName().equals(info.packageName)) throw new Problem(activity.getString(R.string.update_wrong_file));
                commit(apk);
            } catch (Problem e) {
                fail("install", e.getMessage());
            } catch (Exception e) {
                fail("install", activity.getString(R.string.update_download_failed, e.getMessage()));
            } finally {
                apk.delete(); // the installer keeps its own copy
                busy = false;
            }
        }, "netfish-update").start();
    }

    /** The installer's answer (MainActivity.onNewIntent): ask to confirm, done, or why not. */
    void onStatus(Intent intent) {
        if (token == null || !token.equals(intent.getStringExtra("token"))) return;
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = Build.VERSION.SDK_INT >= 33
                    ? intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class)
                    : intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) {
                activity.startActivity(confirm);
                send("install", done());
                return;
            }
        }
        token = null;
        if (status == PackageInstaller.STATUS_SUCCESS) return; // the new version is in
        String why = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        fail("install", status == PackageInstaller.STATUS_FAILURE_ABORTED
                ? activity.getString(R.string.update_cancelled)
                : activity.getString(R.string.update_failed, why != null ? why : String.valueOf(status)));
    }

    // ---------- Steps ----------

    /** The test build (app.netfish.tv.debug) is a different app: the release would install beside it. */
    private boolean ownBuild() {
        return !BuildConfig.DEBUG;
    }

    private void openInstallSetting() {
        try {
            activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())));
        } catch (ActivityNotFoundException e) {
            // Fire TV has no such screen: the message says where the setting is.
        }
    }

    private static JSONObject latest() throws IOException, JSONException {
        HttpURLConnection conn = (HttpURLConnection) new URL("https://api.github.com/repos/" + REPOSITORY + "/releases/latest").openConnection();
        try {
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(15000);
            conn.setRequestProperty("Accept", "application/vnd.github+json");
            conn.setRequestProperty("User-Agent", "Netfish/" + BuildConfig.NETFISH_VERSION);
            if (conn.getResponseCode() != 200) throw new IOException("GitHub " + conn.getResponseCode());
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            try (InputStream in = conn.getInputStream()) {
                byte[] buffer = new byte[8192];
                for (int n; (n = in.read(buffer)) > 0; ) body.write(buffer, 0, n);
            }
            return new JSONObject(body.toString("UTF-8"));
        } finally {
            conn.disconnect();
        }
    }

    private static String apkUrl(JSONObject release) {
        JSONArray assets = release.optJSONArray("assets");
        for (int i = 0; assets != null && i < assets.length(); i++) {
            JSONObject asset = assets.optJSONObject(i);
            if (asset != null && APK.equals(asset.optString("name"))) {
                String url = asset.optString("browser_download_url");
                return url.startsWith("https://github.com/" + REPOSITORY + "/") ? url : null;
            }
        }
        return null;
    }

    private void download(String url, File to) throws IOException, JSONException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        try {
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setRequestProperty("User-Agent", "Netfish/" + BuildConfig.NETFISH_VERSION);
            if (conn.getResponseCode() != 200) throw new IOException("HTTP " + conn.getResponseCode());
            long total = conn.getContentLengthLong();
            long received = 0;
            long told = 0;
            try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(to)) {
                byte[] buffer = new byte[65536];
                for (int n; (n = in.read(buffer)) > 0; ) {
                    out.write(buffer, 0, n);
                    received += n;
                    long now = System.currentTimeMillis();
                    if (now - told > 250) {
                        told = now;
                        send("install", new JSONObject().put("received", received).put("total", Math.max(total, received)));
                    }
                }
            }
            if (total > 0 && received != total) throw new IOException(received + " / " + total);
        } finally {
            conn.disconnect();
        }
    }

    private void commit(File apk) throws IOException {
        PackageInstaller installer = activity.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(activity.getPackageName());
        params.setSize(apk.length());
        int id = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(id)) {
            try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("netfish.apk", 0, apk.length())) {
                byte[] buffer = new byte[65536];
                for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
                session.fsync(out);
            }
            token = UUID.randomUUID().toString();
            Intent answer = new Intent(activity, MainActivity.class).setAction(ACTION_STATUS).putExtra("token", token);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            session.commit(PendingIntent.getActivity(activity, id, answer, flags).getIntentSender());
        }
    }

    // ---------- Telling the page ----------

    private static JSONObject done() {
        try {
            return new JSONObject().put("done", true);
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    private void send(String kind, JSONObject event) {
        try {
            event.put("for", kind);
        } catch (JSONException ignored) {
            // can't happen
        }
        String json = event.toString();
        activity.runOnUiThread(() -> events.send(json));
    }

    private void fail(String kind, String message) {
        try {
            send(kind, new JSONObject().put("error", message));
        } catch (JSONException ignored) {
            // can't happen
        }
    }

    /** "0.6.10" is newer than "0.6.9". */
    static boolean newer(String a, String b) {
        String[] x = a.split("\\."), y = b.split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? number(x[i]) : 0, q = i < y.length ? number(y[i]) : 0;
            if (p != q) return p > q;
        }
        return false;
    }

    private static int number(String s) {
        try {
            return Integer.parseInt(s);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /** A problem worth showing as it is. */
    private static final class Problem extends Exception {
        Problem(String message) {
            super(message);
        }
    }
}
