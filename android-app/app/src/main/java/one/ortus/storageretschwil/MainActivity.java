package one.ortus.storageretschwil;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.content.pm.PackageInfoCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import org.json.JSONObject;

import com.google.firebase.messaging.FirebaseMessaging;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends Activity {
    private FrameLayout root;
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        NotificationHelper.ensureChannel(this);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0F1420"));
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            androidx.core.graphics.Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        setContentView(root);
        ViewCompat.requestApplyInsets(root);

        NotificationPermissionHelper.requestIfNeeded(this);
        registerPushToken();
        checkVersionThenOpen();
    }

    @Override
    protected void onResume() {
        super.onResume();
        NotificationPermissionHelper.requestIfNeeded(this);
    }

    private void registerPushToken() {
        try {
            FirebaseMessaging.getInstance().getToken()
                .addOnSuccessListener(token -> PushTokenRegistrar.register(this, token));
        } catch (IllegalStateException exception) {
            // Firebase is only initialized in release builds that include google-services.json.
        }
    }

    private void checkVersionThenOpen() {
        showLoadingView();
        new Thread(() -> {
            boolean updateRequired = false;
            try {
                HttpURLConnection connection = (HttpURLConnection) new URL(getString(R.string.version_check_url)).openConnection();
                connection.setConnectTimeout(5000);
                connection.setReadTimeout(5000);
                connection.setRequestMethod("GET");

                StringBuilder response = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream()))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        response.append(line);
                    }
                } finally {
                    connection.disconnect();
                }

                JSONObject payload = new JSONObject(response.toString());
                int installedVersionCode = getInstalledVersionCode();
                int latestVersionCode = payload.optInt("latestVersionCode", installedVersionCode);
                updateRequired = payload.optBoolean("required", true) && installedVersionCode < latestVersionCode;
            } catch (Exception exception) {
                updateRequired = false;
            }

            boolean finalUpdateRequired = updateRequired;
            runOnUiThread(() -> {
                if (finalUpdateRequired) {
                    showUpdateView();
                } else {
                    openDashboard();
                }
            });
        }).start();
    }

    private void showLoadingView() {
        TextView label = new TextView(this);
        label.setGravity(Gravity.CENTER);
        label.setText(getString(R.string.app_name));
        label.setTextColor(Color.WHITE);
        label.setTextSize(22);
        root.removeAllViews();
        root.addView(label, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
    }

    private void showUpdateView() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setPadding(44, 44, 44, 44);

        TextView title = new TextView(this);
        title.setText("Update required");
        title.setTextColor(Color.WHITE);
        title.setTextSize(24);
        title.setGravity(Gravity.CENTER);

        TextView body = new TextView(this);
        body.setText("A newer Storage Retschwil app version is available.");
        body.setTextColor(Color.parseColor("#A9C7E8"));
        body.setTextSize(15);
        body.setGravity(Gravity.CENTER);
        body.setPadding(0, 18, 0, 28);

        Button button = new Button(this);
        button.setText("Update in Play Store");
        button.setAllCaps(false);
        button.setOnClickListener(view -> openPlayStore());

        layout.addView(title, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        layout.addView(body, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        layout.addView(button, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        root.removeAllViews();
        root.addView(layout, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
    }

    private void openPlayStore() {
        Intent marketIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(getString(R.string.play_store_market_url)));
        try {
            startActivity(marketIntent);
        } catch (Exception exception) {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(getString(R.string.play_store_url))));
        }
    }

    private int getInstalledVersionCode() {
        try {
            PackageInfo packageInfo = getPackageManager().getPackageInfo(getPackageName(), 0);
            return (int) PackageInfoCompat.getLongVersionCode(packageInfo);
        } catch (Exception exception) {
            return 0;
        }
    }

    private void openDashboard() {
        webView = new WebView(this);
        root.removeAllViews();
        root.addView(webView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString() + " StorageRetschwilAndroid/1.0");

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient());
        webView.loadUrl(getLaunchingUrl().toString());
    }

    private Uri getLaunchingUrl() {
        Uri deepLink = getIntent() == null ? null : getIntent().getData();
        if (deepLink != null) {
            return deepLink;
        }

        return Uri.parse(getString(R.string.launch_url));
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }

        super.onBackPressed();
    }
}
