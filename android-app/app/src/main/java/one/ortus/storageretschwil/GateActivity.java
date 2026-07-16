package one.ortus.storageretschwil;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.graphics.Insets;
import androidx.core.content.ContextCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.fragment.app.FragmentActivity;

import com.google.firebase.messaging.FirebaseMessaging;

import java.util.concurrent.Executor;

import static androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG;
import static androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL;

public class GateActivity extends FragmentActivity {
    private Uri launchUri;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        launchUri = getIntent() == null ? null : getIntent().getData();
        NotificationHelper.ensureChannel(this);
        registerPushToken();
        setLoadingView();
        authenticate();
    }

    private void registerPushToken() {
        try {
            FirebaseMessaging.getInstance().getToken()
                .addOnSuccessListener(token -> PushTokenRegistrar.register(this, token));
        } catch (IllegalStateException exception) {
            // Firebase is only initialized after google-services.json has been added to the release build.
        }
    }

    private void setLoadingView() {
        TextView label = new TextView(this);
        label.setGravity(Gravity.CENTER);
        label.setText(getString(R.string.app_name));
        label.setTextColor(ContextCompat.getColor(this, android.R.color.white));
        label.setTextSize(22);
        label.setBackgroundColor(ContextCompat.getColor(this, android.R.color.black));
        ViewCompat.setOnApplyWindowInsetsListener(label, (view, insets) -> {
            Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        setContentView(label);
        ViewCompat.requestApplyInsets(label);
    }

    private void authenticate() {
        int authenticators = getAuthenticators();
        int availability = BiometricManager.from(this).canAuthenticate(authenticators);

        if (availability != BiometricManager.BIOMETRIC_SUCCESS) {
            Toast.makeText(this, "Biometric authentication is not available.", Toast.LENGTH_LONG).show();
            finish();
            return;
        }

        Executor executor = ContextCompat.getMainExecutor(this);
        BiometricPrompt prompt = new BiometricPrompt(this, executor, new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                super.onAuthenticationSucceeded(result);
                openDashboard();
            }

            @Override
            public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                super.onAuthenticationError(errorCode, errString);
                finish();
            }
        });

        BiometricPrompt.PromptInfo.Builder promptInfo = new BiometricPrompt.PromptInfo.Builder()
            .setTitle(getString(R.string.biometric_title))
            .setSubtitle(getString(R.string.biometric_subtitle))
            .setAllowedAuthenticators(authenticators);

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            promptInfo.setNegativeButtonText(getString(R.string.biometric_cancel));
        }

        prompt.authenticate(promptInfo.build());
    }

    private int getAuthenticators() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return BIOMETRIC_STRONG | DEVICE_CREDENTIAL;
        }

        return BIOMETRIC_STRONG;
    }

    private void openDashboard() {
        Intent intent = new Intent(this, MainActivity.class);
        if (launchUri != null) {
            intent.setData(launchUri);
        }
        startActivity(intent);
        finish();
    }
}
