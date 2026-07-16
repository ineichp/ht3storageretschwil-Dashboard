# Storage Retschwil Google Operations

## Purpose

Google services support the Android app distribution and native app notifications for Storage Retschwil.

## Google Project

Project:

```text
storage-retschwil
```

Project number:

```text
198845542006
```

Required labels:

```text
project = storage-retschwil
storage_retschwil = true
managed_by = codex
owner = ip-skyit
```

Current labels were applied on `2026-07-16`.

## Google Play

Package:

```text
one.ortus.storageretschwil
```

Distribution:

```text
Google Play production track
```

App signing SHA-256:

```text
E7:7D:F8:C1:67:7C:82:12:3C:20:F7:4E:1B:75:59:88:5F:B2:A1:3D:7B:24:31:17:99:06:FB:A3:02:48:D8:AA
```

This fingerprint must be present in:

```text
.well-known/assetlinks.json
```

It allows Android App Links for `https://storageretschwil.ortus.one` to open the installed app instead of the browser.

Store listing metadata:

```text
Title = Storage Retschwil
Short description = Private dashboard for Storage Retschwil monitoring, controls and alerts.
Contact email = ip@skyit.ch
Privacy policy = https://storageretschwil.ortus.one/privacy.html
```

Google Play does not expose AWS-style resource tags for the app through the Android Publisher API. Keep project ownership and lifecycle metadata in the Google Cloud labels and in this repository.

## Firebase Cloud Messaging

Firebase Cloud Messaging is used for Android native push notifications.

AWS secret:

```text
storageretschwil/firebase-service-account
```

AWS Lambda sender:

```text
storageretschwilPushNotifications
```

Android app configuration:

```text
android-app/app/google-services.json
```

The Firebase Admin SDK service account used by AWS is:

```text
firebase-adminsdk-fbsvc@storage-retschwil.iam.gserviceaccount.com
```

## Service Accounts

Known service accounts:

```text
codex-storage-retschwil@storage-retschwil.iam.gserviceaccount.com
firebase-adminsdk-fbsvc@storage-retschwil.iam.gserviceaccount.com
service-198845542006@gcp-sa-firebase.iam.gserviceaccount.com
```

The `service-198845542006@gcp-sa-firebase.iam.gserviceaccount.com` account is a Google-managed Firebase service agent and should not be deleted.

Recommended descriptions:

```text
codex-storage-retschwil:
Codex automation account for Google Play Publisher API and Google Cloud project maintenance for Storage Retschwil.

firebase-adminsdk-fbsvc:
Firebase Admin SDK account used by the AWS push notification Lambda to send Android app notifications for Storage Retschwil.
```

These descriptions could not be applied on `2026-07-16` because `iam.googleapis.com` is disabled and the available service account cannot enable it. To finish this metadata step, enable the IAM API for project `198845542006`, then grant an operator the minimum permissions needed to update service account metadata.

## Metadata Rule

Whenever Google or Android app resources change:

```text
1. Update Google project labels where supported.
2. Update Google Play listing metadata if user-facing app behavior changed.
3. Update Firebase or service account descriptions where supported.
4. Update this repository's docs and changelog.
5. Commit and push the documentation with the implementation change.
```
