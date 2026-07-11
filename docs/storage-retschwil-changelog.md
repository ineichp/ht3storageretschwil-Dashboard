# Storage Retschwil Changelog

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
