package app.netfish.tv;

import android.app.DownloadManager;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Downloads for watching without a connection on phones and tablets, like the
 * iPhone and Mac apps: kept in the app's private storage, downloaded by
 * Android's download manager (keeps going in the background, with a
 * notification), and played by the shared downloads page, which the app
 * serves itself at https://netfish-offline.local so it works offline.
 */
final class OfflineStore {
    static final String HOST = "netfish-offline.local";
    static final String ORIGIN = "https://" + HOST;

    /** Called on the main thread with the public list whenever something changes. */
    interface Listener {
        void changed(String list);
    }

    private final Context context;
    private final DownloadManager downloads;
    private final File root;
    private final File manifest;
    private final List<JSONObject> entries = new ArrayList<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private Listener listener;

    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            if (refresh()) notifyChanged();
            if (anyDownloading()) handler.postDelayed(this, 1000);
        }
    };

    OfflineStore(Context context) {
        this.context = context.getApplicationContext();
        downloads = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        root = new File(context.getExternalFilesDir(null), "Offline");
        manifest = new File(context.getFilesDir(), "offline.json");
        load();
        if (anyDownloading()) handler.post(poll);
    }

    void setListener(Listener listener) {
        this.listener = listener;
    }

    // ---------- Manifest ----------

    private synchronized void load() {
        entries.clear();
        try (InputStream in = new FileInputStream(manifest)) {
            JSONArray list = new JSONArray(new String(readAll(in), StandardCharsets.UTF_8));
            for (int i = 0; i < list.length(); i++) {
                JSONObject e = list.getJSONObject(i);
                if ("done".equals(e.optString("state")) && !videoFile(e).exists()) continue;
                entries.add(e);
            }
        } catch (IOException | JSONException ignored) {
            // nothing downloaded yet
        }
    }

    private synchronized void save() {
        JSONArray list = new JSONArray();
        for (JSONObject e : entries) list.put(e);
        try (OutputStream out = new FileOutputStream(manifest)) {
            out.write(list.toString().getBytes(StandardCharsets.UTF_8));
        } catch (IOException ignored) {
            // try again next change
        }
    }

    private synchronized JSONObject entry(String itemId) {
        for (JSONObject e : entries) if (itemId.equals(e.optString("itemId"))) return e;
        return null;
    }

    boolean hasDownloads() {
        synchronized (this) {
            for (JSONObject e : entries) if ("done".equals(e.optString("state"))) return true;
        }
        return false;
    }

    private synchronized boolean anyDownloading() {
        for (JSONObject e : entries) if ("downloading".equals(e.optString("state"))) return true;
        return false;
    }

    File videoFile(JSONObject e) {
        return new File(new File(root, e.optString("folder")), e.optString("fileName"));
    }

    /** What the pages see: same shape as the other apps' lists, no file paths. */
    synchronized String list() {
        JSONArray list = new JSONArray();
        try {
            for (JSONObject e : entries) {
                JSONObject item = new JSONObject();
                for (String key : new String[] {"itemId", "kind", "title", "seriesId", "seriesTitle", "seasonNumber", "episodeNumber", "subtitle",
                        "fileName", "size", "received", "converted", "durationSeconds", "detailHref", "server", "state", "error", "addedAt"}) {
                    if (e.has(key)) item.put(key, e.get(key));
                }
                String id = e.optString("itemId");
                item.put("video", ORIGIN + "/media/" + id + "/video");
                if (e.has("posterFile")) item.put("poster", ORIGIN + "/media/" + id + "/poster");
                JSONArray subs = new JSONArray();
                JSONArray own = e.optJSONArray("subtitles");
                for (int n = 0; own != null && n < own.length(); n++) {
                    JSONObject s = own.getJSONObject(n);
                    subs.put(new JSONObject().put("label", s.optString("label")).put("code", s.optString("code")).put("url", ORIGIN + "/media/" + id + "/sub/" + n));
                }
                item.put("subtitles", subs);
                list.put(item);
            }
        } catch (JSONException ignored) {
            // can't happen
        }
        return list.toString();
    }

    private void notifyChanged() {
        String list = list();
        handler.post(() -> {
            if (listener != null) listener.changed(list);
        });
    }

    // ---------- Downloading ----------

    private static String safe(String s) {
        String cleaned = (s == null || s.isEmpty() ? "Netfish" : s).replaceAll("[\\\\/:*?\"<>|]+", " ").replaceAll("\\s+", " ").trim();
        if (cleaned.isEmpty()) cleaned = "Netfish";
        return cleaned.length() > 100 ? cleaned.substring(0, 100) : cleaned;
    }

    /** Start (or restart) downloading one movie/episode as described by the server. Returns the list, or {"error"}. */
    String start(String descriptor, String origin) {
        try {
            JSONObject d = new JSONObject(descriptor);
            String itemId = d.optString("itemId");
            if (itemId.isEmpty() || d.optString("fileName").isEmpty() || d.optString("url").isEmpty()) {
                return error(d.optString("error", "The server didn't say what to download"));
            }
            if (origin == null) return error("Not connected to a Netfish server");
            JSONObject existing = entry(itemId);
            if (existing != null && ("done".equals(existing.optString("state")) || "downloading".equals(existing.optString("state")))) return list();

            String kind = d.optString("kind", "Movie");
            String folder = safe("Episode".equals(kind) ? d.optString("seriesTitle") : d.optString("title"));
            SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
            iso.setTimeZone(TimeZone.getTimeZone("UTC"));
            JSONObject e = new JSONObject()
                    .put("itemId", itemId).put("kind", kind).put("title", d.optString("title"))
                    .put("fileName", d.optString("fileName")).put("folder", folder)
                    .put("size", d.optLong("size", 0)).put("received", 0).put("converted", d.optBoolean("converted"))
                    .put("server", origin).put("state", "downloading").put("addedAt", iso.format(new Date()))
                    .put("subtitles", new JSONArray()).put("source", d);
            for (String key : new String[] {"seriesId", "seriesTitle", "seasonNumber", "episodeNumber", "subtitle", "durationSeconds", "detailHref"}) {
                if (d.has(key) && !d.isNull(key)) e.put(key, d.get(key));
            }
            synchronized (this) {
                entries.removeIf(x -> itemId.equals(x.optString("itemId")));
                entries.add(0, e);
            }
            save();
            notifyChanged();
            io.execute(() -> fetchAndEnqueue(e, d, origin));
            return list();
        } catch (JSONException ex) {
            return error("The server didn't say what to download");
        }
    }

    private void fetchAndEnqueue(JSONObject e, JSONObject d, String origin) {
        String cookie = CookieManager.getInstance().getCookie(origin);
        File dir = new File(root, e.optString("folder"));
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        String itemId = e.optString("itemId");
        try {
            // Small things first (artwork, subtitles), then the film through Android's download manager.
            if (d.has("poster") && !d.isNull("poster")) {
                File poster = new File(dir, "." + itemId + ".poster");
                String type = fetch(origin + d.optString("poster"), cookie, poster);
                if (type != null) e.put("posterFile", e.optString("folder") + "/" + poster.getName()).put("posterType", type);
            }
            String base = e.optString("fileName").replaceAll("\\.[^.]+$", "");
            JSONArray subs = d.optJSONArray("subtitles");
            for (int n = 0; subs != null && n < subs.length(); n++) {
                JSONObject sub = subs.getJSONObject(n);
                String code = sub.optString("code", "track" + n);
                File file = new File(dir, base + "." + code + "." + n + ".vtt");
                if (fetch(origin + sub.optString("url"), cookie, file) != null) {
                    e.getJSONArray("subtitles").put(new JSONObject().put("label", sub.optString("label", "Subtitles")).put("code", code)
                            .put("file", e.optString("folder") + "/" + file.getName()));
                }
            }
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(origin + d.optString("url")))
                    .setTitle(d.optString("title"))
                    .setDescription("Netfish download")
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                    .setDestinationInExternalFilesDir(context, null, "Offline/" + e.optString("folder") + "/" + e.optString("fileName"));
            if (cookie != null) request.addRequestHeader("Cookie", cookie);
            File target = videoFile(e);
            //noinspection ResultOfMethodCallIgnored
            target.delete();
            e.put("downloadId", downloads.enqueue(request));
        } catch (JSONException | RuntimeException ex) {
            try {
                e.put("state", "failed").put("error", "Couldn't start the download: " + ex.getMessage());
            } catch (JSONException ignored) {
                // can't happen
            }
        }
        save();
        notifyChanged();
        handler.post(() -> {
            handler.removeCallbacks(poll);
            handler.post(poll);
        });
    }

    private static String fetch(String url, String cookie, File to) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            if (cookie != null) conn.setRequestProperty("Cookie", cookie);
            if (conn.getResponseCode() >= 300) return null;
            try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(to)) {
                byte[] buffer = new byte[65536];
                for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
            }
            String type = conn.getContentType();
            return type == null ? "" : type;
        } catch (IOException ex) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** Ask the download manager how things stand; true when anything changed. */
    private boolean refresh() {
        boolean changed = false;
        synchronized (this) {
            for (JSONObject e : entries) {
                if (!"downloading".equals(e.optString("state")) || !e.has("downloadId")) continue;
                try (Cursor c = downloads.query(new DownloadManager.Query().setFilterById(e.optLong("downloadId")))) {
                    if (c == null || !c.moveToFirst()) {
                        e.put("state", "interrupted");
                        changed = true;
                        continue;
                    }
                    int status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                    long received = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                    long total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                    if (received != e.optLong("received")) {
                        e.put("received", received);
                        changed = true;
                    }
                    if (total > 0 && total != e.optLong("size")) e.put("size", total);
                    if (status == DownloadManager.STATUS_SUCCESSFUL) {
                        e.put("state", "done").put("size", videoFile(e).length()).put("received", videoFile(e).length()).remove("error");
                        changed = true;
                    } else if (status == DownloadManager.STATUS_FAILED) {
                        e.put("state", "failed").put("error", "The download stopped. Try again when you're on your home network.");
                        changed = true;
                    }
                } catch (JSONException | IllegalArgumentException ignored) {
                    // try again next time
                }
            }
        }
        if (changed) save();
        return changed;
    }

    String retry(String itemId) {
        JSONObject e = entry(itemId);
        if (e == null || e.optJSONObject("source") == null) return error("Nothing to retry");
        try {
            e.put("state", "failed");
        } catch (JSONException ignored) {
            // can't happen
        }
        return start(e.optJSONObject("source").toString(), e.optString("server"));
    }

    // ---------- Deleting ----------

    String remove(String itemId) {
        JSONObject e = entry(itemId);
        if (e != null) {
            if (e.has("downloadId")) downloads.remove(e.optLong("downloadId"));
            delete(videoFile(e));
            if (e.has("posterFile")) delete(new File(root, e.optString("posterFile")));
            JSONArray subs = e.optJSONArray("subtitles");
            for (int n = 0; subs != null && n < subs.length(); n++) delete(new File(root, subs.optJSONObject(n).optString("file")));
            File dir = new File(root, e.optString("folder"));
            String[] left = dir.list();
            if (left != null && left.length == 0) delete(dir);
            synchronized (this) {
                entries.remove(e);
            }
            save();
            notifyChanged();
        }
        return list();
    }

    String removeSeries(String key) {
        List<String> ids = new ArrayList<>();
        synchronized (this) {
            for (JSONObject e : entries) {
                String series = e.has("seriesId") ? e.optString("seriesId") : e.optString("seriesTitle");
                if ("Episode".equals(e.optString("kind")) && key.equals(series)) ids.add(e.optString("itemId"));
            }
        }
        for (String id : ids) remove(id);
        return list();
    }

    String clear() {
        List<String> ids = new ArrayList<>();
        synchronized (this) {
            for (JSONObject e : entries) ids.add(e.optString("itemId"));
        }
        for (String id : ids) remove(id);
        deleteTree(root);
        return list();
    }

    long usage() {
        return size(root);
    }

    private static long size(File f) {
        if (f.isFile()) return f.length();
        long total = 0;
        File[] children = f.listFiles();
        if (children != null) for (File c : children) total += size(c);
        return total;
    }

    private static void delete(File f) {
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    private static void deleteTree(File f) {
        File[] children = f.listFiles();
        if (children != null) for (File c : children) deleteTree(c);
        delete(f);
    }

    static String error(String message) {
        try {
            return new JSONObject().put("error", message).toString();
        } catch (JSONException e) {
            return "{\"error\":\"Something went wrong\"}";
        }
    }

    // ---------- Serving the downloads page and files ----------

    /** https://netfish-offline.local/… : the downloads page (with the app bridge) and downloaded files, with byte ranges. */
    WebResourceResponse serve(Uri url, Map<String, String> headers) {
        List<String> parts = url.getPathSegments();
        try {
            if (parts.isEmpty() || "offline.html".equals(parts.get(0))) {
                String page = new String(readAll(context.getAssets().open("offline.html")), StandardCharsets.UTF_8);
                page = page.replaceFirst("<head>", "<head><script>" + BRIDGE + "</script>");
                return new WebResourceResponse("text/html", "utf-8", new ByteArrayInputStream(page.getBytes(StandardCharsets.UTF_8)));
            }
            if (!"media".equals(parts.get(0)) || parts.size() < 3) return notFound();
            JSONObject e = entry(parts.get(1));
            if (e == null) return notFound();
            switch (parts.get(2)) {
                case "video": return file(videoFile(e), e.optString("fileName").endsWith(".mp4") ? "video/mp4" : "video/x-matroska", headers);
                case "poster": return e.has("posterFile") ? file(new File(root, e.optString("posterFile")), e.optString("posterType", "image/jpeg"), headers) : notFound();
                case "sub":
                    JSONArray subs = e.optJSONArray("subtitles");
                    int n = parts.size() > 3 ? Integer.parseInt(parts.get(3)) : -1;
                    return subs != null && n >= 0 && n < subs.length() ? file(new File(root, subs.getJSONObject(n).optString("file")), "text/vtt", headers) : notFound();
                default: return notFound();
            }
        } catch (IOException | JSONException | NumberFormatException ex) {
            return notFound();
        }
    }

    /**
     * The file, for the web view. Seeking asks for a byte range: Android's web view skips
     * into the stream itself, so the stream always starts at the beginning, but the answer
     * must say which part it is (206 + Content-Range) or the video player gets confused.
     */
    private static WebResourceResponse file(File f, String type, Map<String, String> headers) throws IOException {
        if (!f.exists()) return notFound();
        long size = f.length();
        Map<String, String> out = new HashMap<>();
        out.put("Accept-Ranges", "bytes");
        out.put("Access-Control-Allow-Origin", "*");
        String range = null;
        if (headers != null) for (Map.Entry<String, String> h : headers.entrySet()) if ("range".equalsIgnoreCase(h.getKey())) range = h.getValue();
        if (range != null && range.matches("bytes=\\d+-\\d*")) {
            long start = Long.parseLong(range.substring(6, range.indexOf('-')));
            if (start >= size) return new WebResourceResponse(type, null, 416, "Range Not Satisfiable", out, new ByteArrayInputStream(new byte[0]));
            out.put("Content-Range", "bytes " + start + "-" + (size - 1) + "/" + size);
            return new WebResourceResponse(type, null, 206, "Partial Content", out, new FileInputStream(f));
        }
        return new WebResourceResponse(type, null, 200, "OK", out, new FileInputStream(f));
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<>(), new ByteArrayInputStream("Not found".getBytes(StandardCharsets.UTF_8)));
    }

    private static byte[] readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[16384];
        for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
        in.close();
        return out.toByteArray();
    }

    /** window.netfishDesktop for the downloads page, on top of the app's Java bridge (NetfishAndroid). */
    private static final String BRIDGE = "(() => {"
            + "const n = window.NetfishAndroid; if (!n || window.netfishDesktop) return;"
            + "const parse = (s) => { const r = JSON.parse(s); if (r && !Array.isArray(r) && r.error) throw new Error(r.error); return r; };"
            + "const offline = new Set(); window.__netfishOfflineChanged = (l) => offline.forEach((cb) => cb(l));"
            + "window.netfishDesktop = { platform: n.platform(), version: n.version(),"
            + " offlineList: async () => parse(n.offlineList()), onOfflineChange: (cb) => { offline.add(cb); return () => offline.delete(cb); },"
            + " removeOffline: async (id) => parse(n.removeOffline(id)), removeOfflineSeries: async (k) => parse(n.removeOfflineSeries(k)),"
            + " retryOffline: async (id) => parse(n.retryOffline(id)), offlineUsage: async () => Number(n.offlineUsage()),"
            + " clearOffline: async () => parse(n.clearOffline()), openServer: () => n.openServer(), openOffline: (t) => n.openOffline(JSON.stringify(t || {})),"
            + " filmShowing: (on) => n.filmShowing(Boolean(on)) };"
            + "})();";
}
