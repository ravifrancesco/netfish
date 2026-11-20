package app.netfish.tv;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.webkit.ProxyConfig;
import androidx.webkit.ProxyController;
import androidx.webkit.WebViewFeature;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.ProxySelector;
import java.net.SocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;

/**
 * Away from home: WireGuard inside the app (netfish-tunnel, from apps/common/tunnel, installed as
 * libnetfishtunnel.so so Android lets it run), used only by Netfish and only when the server
 * can't be reached directly. The page and the player reach the server through its proxy on
 * 127.0.0.1; everything else, on the device and in the app, goes as usual. The configuration (its
 * private key) stays in the app's own storage: never shown again, never logged.
 */
final class Tunnel {
    private static final String TAG = "NetfishTunnel";
    private static final String KEY = "tunnel";

    private final Context context;
    private final SharedPreferences prefs;
    private final ProxySelector system = ProxySelector.getDefault();
    private Process process;
    /** The running tunnel's input: kept open (closing it ends the tunnel). */
    private Writer input;
    private volatile int port;
    /** The server's host: the only one sent through the tunnel. */
    private volatile String host;
    private volatile boolean active;
    private volatile String problem;

    Tunnel(Context context, SharedPreferences prefs) {
        this.context = context.getApplicationContext();
        this.prefs = prefs;
        // The app's own connections to the server (the player, downloads, checks) through the tunnel while it's on.
        ProxySelector.setDefault(new ProxySelector() {
            @Override
            public List<Proxy> select(URI uri) {
                if (active && host != null && host.equalsIgnoreCase(uri.getHost())) {
                    return Collections.singletonList(new Proxy(Proxy.Type.HTTP, new InetSocketAddress("127.0.0.1", port)));
                }
                return system != null ? system.select(uri) : Collections.singletonList(Proxy.NO_PROXY);
            }

            @Override
            public void connectFailed(URI uri, SocketAddress address, IOException e) {
                // the next request tries again
            }
        });
    }

    boolean configured() {
        return prefs.getString(KEY, null) != null;
    }

    boolean active() {
        return active;
    }

    /** Why the tunnel last couldn't start, if it couldn't. */
    String problem() {
        return problem;
    }

    private String binary() {
        return new File(context.getApplicationInfo().nativeLibraryDir, "libnetfishtunnel.so").getPath();
    }

    /** The network's DNS servers (a Linux build of the tunnel can't find them on Android itself). */
    private String dns() {
        List<String> servers = new ArrayList<>();
        ConnectivityManager networks = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        LinkProperties link = networks == null ? null : networks.getLinkProperties(networks.getActiveNetwork());
        if (link != null) for (InetAddress a : link.getDnsServers()) servers.add(a.getHostAddress());
        servers.add("1.1.1.1");
        return String.join(",", servers);
    }

    /** Runs the tunnel with this configuration; its first line ("PORT n", "OK", "ERROR …"), or null if none came in time. */
    private String launch(String config, boolean check) throws IOException {
        List<String> command = new ArrayList<>(List.of(binary(), "-dns", dns()));
        if (check) command.add("-check");
        Process p = new ProcessBuilder(command).redirectErrorStream(true).start();
        Writer in = new OutputStreamWriter(p.getOutputStream(), StandardCharsets.UTF_8);
        in.write(config);
        in.write("\n.\n");
        in.flush(); // (left open: closing it ends the tunnel)
        String[] first = new String[1];
        CountDownLatch said = new CountDownLatch(1);
        new Thread(() -> {
            try {
                first[0] = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8)).readLine();
            } catch (IOException ignored) {
                // gone
            }
            said.countDown();
        }, "netfish-tunnel-out").start();
        try {
            said.await(15, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        if (check) {
            p.destroy();
        } else {
            process = p;
            input = in;
        }
        return first[0];
    }

    /** A configuration, checked by the tunnel itself and kept: null, or what's wrong with it. */
    String save(String config) {
        try {
            String said = launch(config, true);
            if (said == null) return "the tunnel didn't answer";
            if (!said.equals("OK")) return said.replaceFirst("^ERROR ", "");
        } catch (IOException e) {
            return e.getMessage();
        }
        stop();
        prefs.edit().putString(KEY, config.trim()).apply();
        return null;
    }

    void remove() {
        stop();
        prefs.edit().remove(KEY).apply();
    }

    /** Up (or already up) for this server: true once its proxy listens. Off the main thread. */
    synchronized boolean start(String server) {
        if (active && process != null && alive(process)) return true;
        stop();
        String config = prefs.getString(KEY, null);
        if (config == null) return false;
        host = Uri.parse(server).getHost();
        try {
            String said = launch(config, false);
            if (said != null && said.startsWith("PORT ")) {
                port = Integer.parseInt(said.substring(5).trim());
                active = true;
                problem = null;
                return true;
            }
            problem = said == null ? "the tunnel didn't answer" : said.replaceFirst("^ERROR ", "");
        } catch (IOException | NumberFormatException e) {
            problem = e.getMessage();
        }
        Log.w(TAG, "couldn't start: " + problem);
        stop();
        return false;
    }

    synchronized void stop() {
        active = false;
        if (process != null) process.destroy();
        process = null;
        input = null;
    }

    private static boolean alive(Process p) {
        try {
            p.exitValue();
            return false;
        } catch (IllegalThreadStateException e) {
            return true;
        }
    }

    /** The page's connections to the server through the tunnel, or not, as it is now; then `done` (main thread). */
    void applyToPage(Runnable done) {
        Handler main = new Handler(Looper.getMainLooper());
        Executor onMain = main::post;
        // (A web view too old to be told: the page goes as it is, the player through the tunnel all the same.)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE) && active) {
            ProxyConfig.Builder config = new ProxyConfig.Builder().addProxyRule("127.0.0.1:" + port);
            // Only the server through it, where the web view can do that; else all (the tunnel sends the rest straight on).
            if (WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE_REVERSE_BYPASS)) {
                config.addBypassRule(host).setReverseBypassEnabled(true);
            }
            ProxyController.getInstance().setProxyOverride(config.build(), onMain, done);
        } else if (WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
            ProxyController.getInstance().clearProxyOverride(onMain, done);
        } else {
            main.post(done);
        }
    }
}
