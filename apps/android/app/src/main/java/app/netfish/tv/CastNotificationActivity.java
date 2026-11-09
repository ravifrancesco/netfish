package app.netfish.tv;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/**
 * Google's Chromecast notification, tapped: Netfish's player for the film playing there, which
 * picks up where the Chromecast is. Google opens the notification's page in a fresh task,
 * clearing it, so it opens this one (a task of its own, never seen) rather than Netfish's,
 * which would start again from Home.
 */
public class CastNotificationActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String item = CastEngine.playingItem(this);
        startActivity(new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra("path", item != null ? "/watch/" + item : "/"));
        finish();
    }
}
