package app.netfish.tv;

import android.graphics.Color;
import android.service.dreams.DreamService;
import android.webkit.WebSettings;
import android.webkit.WebView;

/**
 * Netfish as the screensaver (Android's, chosen in its settings): the server's screensaver page,
 * the library's backdrops drifting by with what's on Netfish's channel. Signed in as the app is
 * (the same cookies). Any key or touch ends it.
 */
public class NetfishDream extends DreamService {
    private WebView web;

    @Override
    public void onAttachedToWindow() {
        super.onAttachedToWindow();
        setInteractive(false);
        setFullscreen(true);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + " NetfishScreensaver/" + BuildConfig.NETFISH_VERSION);
        setContentView(web);
        String server = getSharedPreferences("netfish", MODE_PRIVATE).getString("server", null);
        if (server != null) web.loadUrl(server.replaceAll("/+$", "") + "/screensaver");
    }

    @Override
    public void onDetachedFromWindow() {
        if (web != null) web.destroy();
        web = null;
        super.onDetachedFromWindow();
    }
}
