# Storage Retschwil Android App

Trusted Web Activity wrapper for `https://storageretschwil.ortus.one`.

## Build

```powershell
gradle assembleDebug
```

The debug build uses the local Android debug certificate. Its SHA-256 fingerprint is already included in:

```text
../ht3storageretschwil-Dashboard/.well-known/assetlinks.json
```

For Google Play, replace or add the Play App Signing SHA-256 fingerprint in `assetlinks.json`, then deploy the dashboard again.

## Package

```text
one.ortus.storageretschwil
```

## Security

The app opens through a native biometric gate before the dashboard starts. Android will use fingerprint/thumb authentication where available and device credentials on newer Android versions as fallback.

## Native Notifications

The app contains the Android notification channel and Firebase Messaging receiver. Existing WhatsApp notifications are not changed.

To enable real push delivery, add Firebase Cloud Messaging configuration:

1. Create or use a Firebase project.
2. Add this Android app package: `one.ortus.storageretschwil`.
3. Place `google-services.json` in `app/`.
4. Add the token registration endpoint to `notification_registration_url` in `app/src/main/res/values/strings.xml`.
5. Send the same alert events from the backend to FCM in addition to WhatsApp.

## Release Notes

The app shell is intentionally thin. The dashboard remains the source of truth and is updated through Amplify.
