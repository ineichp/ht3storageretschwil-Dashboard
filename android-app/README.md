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

The app contains the Android notification channel, Firebase Messaging receiver, and runtime notification permission request. Existing WhatsApp notifications are not changed.

AWS backend support is wired as follows:

- `POST https://onbcgvleu4.execute-api.eu-central-1.amazonaws.com/push-tokens` registers Android FCM tokens.
- Registered tokens are stored in DynamoDB item `storageretschwilconfig/androidPushTokens`.
- Existing alert flows now send Android push notifications in addition to WhatsApp:
  - measurement threshold alerts
  - surveillance video detection alerts
  - flood alerts
  - device status alerts
- The app asks for Android notification permission after successful biometric login so the permission dialog is visible in the dashboard flow.

To enable real push delivery, add Firebase Cloud Messaging configuration:

1. Create or use a Firebase project.
2. Add this Android app package: `one.ortus.storageretschwil`.
3. Place `google-services.json` in `app/`.
4. Ensure Firebase Cloud Messaging API is enabled in Google Cloud.
5. Build and publish a new Play release.

## Release Notes

The app shell is intentionally thin. The dashboard remains the source of truth and is updated through Amplify.

For each Android release, keep the following in sync:

```text
1. Google Play listing metadata
2. Google Cloud project labels
3. Firebase service account documentation
4. GitHub docs and changelog
```
