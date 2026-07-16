package one.ortus.storageretschwil;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public final class NotificationPermissionHelper {
    public static final int REQUEST_CODE = 1001;

    private NotificationPermissionHelper() {
    }

    public static boolean hasPermission(Context context) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    public static void requestIfNeeded(Activity activity) {
        if (hasPermission(activity)) {
            return;
        }

        ActivityCompat.requestPermissions(
            activity,
            new String[] { Manifest.permission.POST_NOTIFICATIONS },
            REQUEST_CODE
        );
    }
}
