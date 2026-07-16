# Storage Retschwil Changelog

## 2026-07-16

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
- Existing WhatsApp notification flows were not changed by this metadata update.
