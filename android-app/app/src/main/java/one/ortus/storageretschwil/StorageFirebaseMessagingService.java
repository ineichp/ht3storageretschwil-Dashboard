package one.ortus.storageretschwil;

import android.util.Log;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class StorageFirebaseMessagingService extends FirebaseMessagingService {
    private static final String TAG = "StorageFCM";

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        registerToken(token);
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);

        String title = getString(R.string.app_name);
        String body = "Storage Retschwil Alert";

        if (message.getNotification() != null) {
            if (message.getNotification().getTitle() != null) {
                title = message.getNotification().getTitle();
            }
            if (message.getNotification().getBody() != null) {
                body = message.getNotification().getBody();
            }
        }

        if (message.getData().containsKey("title")) {
            title = message.getData().get("title");
        }
        if (message.getData().containsKey("body")) {
            body = message.getData().get("body");
        }

        NotificationHelper.showAlert(this, title, body);
    }

    private void registerToken(String token) {
        String registrationUrl = getString(R.string.notification_registration_url);
        if (registrationUrl == null || registrationUrl.trim().isEmpty()) {
            Log.i(TAG, "FCM token created. Registration endpoint is not configured yet.");
            return;
        }

        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL(registrationUrl);
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setDoOutput(true);

                String payload = "{\"token\":\"" + token + "\",\"platform\":\"android\"}";
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(payload.getBytes(StandardCharsets.UTF_8));
                }

                int status = connection.getResponseCode();
                Log.i(TAG, "FCM token registration status: " + status);
            } catch (Exception exception) {
                Log.w(TAG, "FCM token registration failed.", exception);
            } finally {
                if (connection != null) {
                    connection.disconnect();
                }
            }
        }).start();
    }
}
