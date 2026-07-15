package one.ortus.storageretschwil;

import android.content.Context;
import android.util.Log;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class PushTokenRegistrar {
    private static final String TAG = "StoragePushToken";

    private PushTokenRegistrar() {
    }

    public static void register(Context context, String token) {
        String registrationUrl = context.getString(R.string.notification_registration_url);
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

                String escapedToken = token.replace("\\", "\\\\").replace("\"", "\\\"");
                String payload = "{\"token\":\"" + escapedToken + "\",\"platform\":\"android\"}";
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
