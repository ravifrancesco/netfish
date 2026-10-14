package app.netfish.tv;

import android.app.Activity;
import android.app.UiModeManager;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.annotation.OptIn;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.ui.PlayerView;

import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Netfish for Android: phones, tablets, Fire TV and Android TV. A full-screen
 * web view of the Netfish server on your network (on TVs in its TV mode, for
 * the remote). The app only remembers the server address; everything else
 * comes from the server, so updating the Netfish container updates the app
 * too. Films play in ExoPlayer underneath the page (see VideoEngine), with
 * Netfish's own player controls on top. Phones and tablets can download films
 * to watch offline (see OfflineStore).
 */
@OptIn(markerClass = UnstableApi.class)
public class MainActivity extends Activity {
    private static final String SETUP = "file:///android_asset/setup.html";

    private WebView web;
    private VideoEngine video;
    private OfflineStore offline;
    private SharedPreferences prefs;
    private boolean tv;
    private volatile String currentUrl = "";
    private String returnUrl;
    private boolean forgetHistory;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("netfish", MODE_PRIVATE);
        UiModeManager modes = (UiModeManager) getSystemService(UI_MODE_SERVICE);
        tv = modes.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION
                || getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK);
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        if (tv) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        } else {
            getWindow().setStatusBarColor(0xff06080b);
            getWindow().setNavigationBarColor(0xff06080b);
            offline = new OfflineStore(this);
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        // The film (ExoPlayer) at the bottom, the Netfish page on top: see-through while a film plays.
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xff06080b);
        PlayerView playerView = new PlayerView(this);
        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        root.addView(playerView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        video = new VideoEngine(this, playerView, state ->
                web.evaluateJavascript("window.__netfishVideo&&window.__netfishVideo(" + state + ")", null));
        video.setActiveListener(this::filmShowing);
        if (offline != null) {
            offline.setListener(list -> web.evaluateJavascript("window.__netfishOfflineChanged&&window.__netfishOfflineChanged(" + list + ")", null));
        }

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        // TVs: "NetfishTV" switches the interface to TV mode (remote-control navigation).
        settings.setUserAgentString(settings.getUserAgentString() + (tv ? " NetfishTV/" : " NetfishAndroid/") + BuildConfig.NETFISH_VERSION);

        Bridge bridge = new Bridge();
        web.addJavascriptInterface(bridge, "NetfishAndroid");
        web.addJavascriptInterface(bridge, "NetfishTV"); // the name earlier versions used
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                String server = server();
                // Stay on the Netfish server (and the app's own pages).
                return !(url.startsWith("file:///android_asset/") || url.startsWith(OfflineStore.ORIGIN) || (server != null && url.startsWith(server)));
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (offline != null && OfflineStore.HOST.equals(request.getUrl().getHost())) return offline.serve(request.getUrl(), request.getRequestHeaders());
                return null;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                currentUrl = url;
                // A new page never keeps a film playing underneath it.
                video.stop();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (forgetHistory && !url.startsWith(SETUP)) {
                    // Back from the home screen shouldn't land on the setup page again.
                    forgetHistory = false;
                    view.clearHistory();
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                String url = request.getUrl().toString();
                if (!request.isForMainFrame() || url.startsWith("file:") || url.startsWith(OfflineStore.ORIGIN)) return;
                // Away from home with films downloaded: straight to them.
                if (offline != null && offline.hasDownloads()) showOffline(new JSONObject());
                else showSetup("Couldn't reach " + server() + " (" + error.getDescription() + "). Is the server on?");
            }
        });

        String server = server();
        if (server == null) showSetup(null);
        else web.loadUrl(server);
        web.requestFocus();
    }

    private String server() {
        return prefs.getString("server", null);
    }

    private void showSetup(String error) {
        web.loadUrl(SETUP + (error != null ? "?error=" + Uri.encode(error) : ""));
    }

    private void showOffline(JSONObject target) {
        String server = server();
        if (server != null && currentUrl.startsWith(server)) returnUrl = currentUrl;
        Uri.Builder url = Uri.parse(OfflineStore.ORIGIN + "/offline.html").buildUpon();
        if (target.has("play")) url.appendQueryParameter("play", target.optString("play"));
        if (target.has("show")) url.appendQueryParameter("show", target.optString("show"));
        web.loadUrl(url.toString());
    }

    private void showServer() {
        String server = server();
        if (server == null) {
            showSetup(null);
            return;
        }
        web.loadUrl(returnUrl != null && returnUrl.startsWith(server) ? returnUrl : server);
        returnUrl = null;
    }

    /** Phones: a film fills the screen, sideways, without the status bar; back to normal after. */
    private void filmShowing(boolean showing) {
        if (tv) return;
        setRequestedOrientation(showing ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController bars = getWindow().getInsetsController();
            if (bars == null) return;
            if (showing) {
                bars.hide(WindowInsets.Type.systemBars());
                bars.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            } else {
                bars.show(WindowInsets.Type.systemBars());
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(showing
                    ? View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    : View.SYSTEM_UI_FLAG_VISIBLE);
        }
        if (showing) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    // ---------- Back (remote, gesture, Esc) ----------

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        // Esc too, for keyboards (and the emulator): the remote's Back button sends KEYCODE_BACK.
        if (event.getKeyCode() == KeyEvent.KEYCODE_BACK || event.getKeyCode() == KeyEvent.KEYCODE_ESCAPE) {
            if (event.getAction() == KeyEvent.ACTION_UP) back();
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    /** Back closes whatever is open in the page first, then goes back a page; on Home it leaves the app. */
    private void back() {
        web.evaluateJavascript("(function(){try{return !!(window.netfishBack&&window.netfishBack())}catch(e){return false}})()", handled -> {
            if ("true".equals(handled)) return;
            String url = web.getUrl() == null ? "" : web.getUrl();
            String server = server();
            if (url.startsWith(SETUP)) {
                if (server != null && !url.contains("error=")) web.loadUrl(server);
                else moveTaskToBack(true);
            } else if (url.startsWith(OfflineStore.ORIGIN)) {
                // The downloads page handles its own player; otherwise back to Netfish.
                web.evaluateJavascript("(function(){var p=document.getElementById('player');if(p&&!p.hidden){document.getElementById('close').click();return true}return false})()", closed -> {
                    if (!"true".equals(closed)) showServer();
                });
            } else if (server != null && (url.equals(server) || url.equals(server + "/"))) {
                moveTaskToBack(true);
            } else if (web.canGoBack()) {
                web.goBack();
            } else if (server != null) {
                web.loadUrl(server);
            } else {
                moveTaskToBack(true);
            }
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Pressing Home mid-film pauses it, like any TV or phone app.
        web.evaluateJavascript("document.querySelectorAll('video').forEach(function(v){v.pause()})", null);
        video.pause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        video.release();
        web.destroy();
        super.onDestroy();
    }

    // ---------- Server address ----------

    /** Only the Netfish server's own pages may use the player and downloads. */
    static final class Server {
        static boolean ownsPage(String page, String server) {
            return server != null && page != null && page.startsWith(server);
        }
    }

    /** "192.168.1.50" → "http://192.168.1.50:7777"; real domains keep their own port. */
    static String normalize(String input) throws Exception {
        String value = input == null ? "" : input.trim();
        if (value.isEmpty()) throw new Exception("Enter the address of your Netfish server");
        if (!value.matches("(?i)^https?://.*")) value = "http://" + value;
        Uri uri = Uri.parse(value);
        String host = uri.getHost();
        if (host == null || host.isEmpty()) throw new Exception("That doesn't look like an address");
        String scheme = uri.getScheme().toLowerCase();
        boolean local = host.matches("^\\d{1,3}(\\.\\d{1,3}){3}$") || host.endsWith(".local") || !host.contains(".");
        int port = uri.getPort();
        if (port == -1 && scheme.equals("http") && local) port = 7777;
        return scheme + "://" + host + (port == -1 ? "" : ":" + port);
    }

    /** Make sure the address really is a Netfish server before saving it. */
    static void probe(String origin) throws Exception {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(origin + "/api/health").openConnection();
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(6000);
            int status = conn.getResponseCode();
            InputStream in = status < 400 ? conn.getInputStream() : conn.getErrorStream();
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            for (int n; in != null && (n = in.read(buffer)) > 0; ) body.write(buffer, 0, n);
            JSONObject json = new JSONObject(body.toString("UTF-8"));
            if (status >= 400 || !"netfish".equals(json.optString("name"))) throw new Exception(origin + " doesn't look like a Netfish server");
        } catch (JSONException e) {
            throw new Exception(origin + " doesn't look like a Netfish server");
        } catch (java.io.IOException e) {
            throw new Exception("Can't reach " + origin + " (" + e.getMessage() + ")");
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** What pages can ask of the app: window.NetfishAndroid.* (strings in and out). */
    private class Bridge {
        private boolean fromServer() {
            return Server.ownsPage(currentUrl, server());
        }

        private boolean fromApp() {
            return fromServer() || currentUrl.startsWith(OfflineStore.ORIGIN);
        }

        @JavascriptInterface
        public String version() {
            return BuildConfig.NETFISH_VERSION;
        }

        /** firetv (TVs: remote control, no downloads) or android (phones and tablets). */
        @JavascriptInterface
        public String platform() {
            return tv ? "firetv" : "android";
        }

        @JavascriptInterface
        public String currentServer() {
            String server = server();
            return server == null ? "" : server;
        }

        /** Setup page only. Returns "" on success, otherwise what went wrong. Blocks while checking. */
        @JavascriptInterface
        public String connect(String input) {
            if (!currentUrl.startsWith(SETUP)) return "Not allowed here";
            try {
                String origin = normalize(input);
                probe(origin);
                prefs.edit().putString("server", origin).apply();
                runOnUiThread(() -> {
                    forgetHistory = true;
                    web.loadUrl(origin);
                });
                return "";
            } catch (Exception e) {
                return e.getMessage();
            }
        }

        @JavascriptInterface
        public void changeServer() {
            runOnUiThread(() -> showSetup(null));
        }

        /** Keep the screen from dimming while a film plays in the page. */
        @JavascriptInterface
        public void keepAwake(boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        // ----- The player underneath the page -----

        /** What ExoPlayer plays as-is (a Jellyfin device profile). */
        @JavascriptInterface
        public String videoProfile() {
            return DeviceProfile.build();
        }

        @JavascriptInterface
        public void videoLoad(String request) {
            if (!fromServer()) return;
            try {
                JSONObject parsed = new JSONObject(request);
                if (!Server.ownsPage(parsed.optString("url"), server())) return;
                runOnUiThread(() -> video.load(parsed));
            } catch (JSONException ignored) {
                // nothing to play
            }
        }

        /** play, pause, seek, audio, subtitle, volume, mute, controls, stop (value as JSON). */
        @JavascriptInterface
        public void videoCommand(String name, String value) {
            if (!fromServer()) return;
            Object parsed;
            try {
                parsed = new JSONTokener(value == null ? "null" : value).nextValue();
            } catch (JSONException e) {
                parsed = null;
            }
            Object argument = parsed == JSONObject.NULL ? null : parsed;
            runOnUiThread(() -> video.command(name, argument));
        }

        // ----- Downloads (phones and tablets) -----

        @JavascriptInterface
        public String download(String descriptor) {
            if (offline == null || !fromServer()) return OfflineStore.error("Downloads aren't available on this device");
            return offline.start(descriptor, server());
        }

        @JavascriptInterface
        public String offlineList() {
            return offline == null || !fromApp() ? "[]" : offline.list();
        }

        @JavascriptInterface
        public String removeOffline(String itemId) {
            return offline == null || !fromApp() ? "[]" : offline.remove(itemId);
        }

        @JavascriptInterface
        public String removeOfflineSeries(String key) {
            return offline == null || !fromApp() ? "[]" : offline.removeSeries(key);
        }

        @JavascriptInterface
        public String retryOffline(String itemId) {
            return offline == null || !fromApp() ? "[]" : offline.retry(itemId);
        }

        @JavascriptInterface
        public String clearOffline() {
            return offline == null || !fromApp() ? "[]" : offline.clear();
        }

        @JavascriptInterface
        public double offlineUsage() {
            return offline == null ? 0 : offline.usage();
        }

        @JavascriptInterface
        public void openOffline(String target) {
            if (offline == null || !fromApp()) return;
            JSONObject parsed;
            try {
                parsed = new JSONObject(target == null ? "{}" : target);
            } catch (JSONException e) {
                parsed = new JSONObject();
            }
            JSONObject finalTarget = parsed;
            runOnUiThread(() -> showOffline(finalTarget));
        }

        @JavascriptInterface
        public void openServer() {
            runOnUiThread(MainActivity.this::showServer);
        }

        /** The downloads page's own player: full screen and sideways on phones, like the main player. */
        @JavascriptInterface
        public void filmShowing(boolean showing) {
            runOnUiThread(() -> {
                String page = web.getUrl();
                if (page != null && page.startsWith(OfflineStore.ORIGIN)) MainActivity.this.filmShowing(showing);
            });
        }
    }
}
