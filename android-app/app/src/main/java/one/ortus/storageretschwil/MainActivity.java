package one.ortus.storageretschwil;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import com.google.firebase.messaging.FirebaseMessaging;

public class MainActivity extends Activity {
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(Color.parseColor("#0F1420"));
        getWindow().setNavigationBarColor(Color.parseColor("#0F1420"));
        NotificationHelper.ensureChannel(this);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0F1420"));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(0, insets.getSystemWindowInsetTop(), 0, insets.getSystemWindowInsetBottom());
            return insets;
        });

        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(root);
        root.requestApplyInsets();

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

        NotificationPermissionHelper.requestIfNeeded(this);
        registerPushToken();
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
