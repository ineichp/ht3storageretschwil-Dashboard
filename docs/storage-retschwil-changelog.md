# Storage Retschwil Changelog

## 2026-07-26

- Updated the public privacy policy after WhatsApp/CallMeBot decommissioning so alert delivery is documented as Android app push notifications only.
- Bumped the service worker shell cache to ensure Google Play and browsers receive the current privacy policy page.

## 2026-07-18

- Decommissioned WhatsApp/CallMeBot alert delivery. Measurement, flood, device, and video detection alerts now use Android app notifications only.
- Removed CallMeBot Lambda environment variables and cleaned stale WhatsApp alert state from `storageretschwilconfig`.
- Added automatic backend setting refresh for dashboard controls so threshold and notification changes made in the web dashboard appear in the Android app without closing and reopening the app.
- Submitted Android app release `1.0.7` / `versionCode 8` so tapping/opening a Storage Retschwil notification actively clears app notifications.
- Changed Audit Costs `lastDay` selection so the dashboard prefers the latest completed/billable day and no longer shows the current empty Cost Explorer estimate as `CHF 0.00`.
- Bumped the Audit Costs daily cache key to `storage-retschwil-services-v3`.
- Added unchanged-state suppression for measurement and flood alerts so Android push notifications are only sent when the alert values/state changed since the last sent notification.
- Changed Firebase Cloud Messaging payloads to data-only messages for Storage Retschwil alerts so the Android app creates the notification locally and attaches the app-opening intent consistently.

## 2026-07-16

- Bumped dashboard asset and service-worker cache versions after Audit Costs estimate changes and added a frontend guard so month estimate cannot render lower than month-to-date.
- Rechecked AWS tags for Cost Explorer-relevant supporting resources and added missing standard tags to EC2 root volume, ENI, security group, Elastic IP, API Gateway default stage, and selected CloudWatch log groups.
- Changed the Audit Costs estimate card from top-service projection to full Storage Retschwil month projection.
- Corrected Audit Costs from tag-only scope to Storage Retschwil service-scope because tag-only excluded AWS Cost Explorer and other project-relevant shared service costs.
- Changed the Audit Costs top service card to show the projected full-month cost for the current top Storage Retschwil service.
- Replaced the attempted tag-only audit cost scope with service-scope reporting so Month-to-date no longer shows the whole AWS account but still includes project-relevant untaggable/shared service costs.
- Moved the local Google Play Publisher API service account reference into `.local-secrets/google-play-publisher-service-account.json`; the private key remains gitignored.
- Submitted Android app release `1.0.6` / `versionCode 7` to address Google Play release dashboard recommendations:
  - edge-to-edge inset handling for Android 15+
  - removed deprecated status/navigation bar color APIs
  - removed fixed portrait activity restrictions
  - enabled R8 minification and resource shrinking
- Added native Android startup version check in app release `1.0.5` / `versionCode 6`.
- Added `android-version.json` as the dashboard-hosted source of truth for the latest Android app version.
- Set `android-version.json` back to the actually public Play Store version while `1.0.5` is still in Google review.
- Removed Google Play tester group assignments from the historical `internal` and `alpha` tracks.
- Added the Google Play App Signing SHA-256 fingerprint to `.well-known/assetlinks.json` so Android can open `storageretschwil.ortus.one` links directly in the installed app.
- Added Android push notification reliability fixes in app release `1.0.4` / `versionCode 5`.
- Updated the `storageretschwilPushNotifications` Lambda payload so `title` and `body` are available as FCM data fields.
- Confirmed direct Android push test delivery through Firebase with `sent: 3` and `failed: 0`.
- Applied Google Cloud project labels for `storage-retschwil`:
  - `project = storage-retschwil`
  - `storage_retschwil = true`
  - `managed_by = codex`
  - `owner = ip-skyit`
- Updated Google Play listing metadata for `one.ortus.storageretschwil`.
- Documented Google/Firebase/Play operations and the required metadata rule for future changes.
- Noted that Google service account descriptions still require the Google IAM API to be enabled for project `198845542006`.

## 2026-07-11

- Harmonized AWS resource tagging for Storage Retschwil resources.
- Standardized core tags:
  - `Project = Storage-Retschwil`
  - `Storage-Retschwil = true`
  - `ManagedBy = Terraform`
  - `Owner = Codex`
- Added or normalized `Name` and `Description` tags across Lambda, DynamoDB, S3, EC2, API Gateway, Amplify, Cognito, SNS, EventBridge, IoT, CloudWatch Logs, IAM roles, IAM policies, and Resource Groups.
- Added missing IAM role descriptions where supported.
- Verified that 38 resources are returned by the `Project=Storage-Retschwil` tag filter in `eu-central-1`.
- Added Git-tracked documentation for operations, runbook, architecture, and changelog.

## Notes

- No production resource names were changed.
- Legacy names with typos were left in place to avoid breaking ARN-based integrations.
- Existing alert behavior was not changed by this metadata update.
