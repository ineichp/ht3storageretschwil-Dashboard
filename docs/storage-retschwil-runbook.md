# Storage Retschwil Runbook

## AWS Login

Use the Codex Terraform profile:

```powershell
aws sso login --profile codex-terraform
aws sts get-caller-identity --profile codex-terraform
```

Expected account:

```text
024113141954
```

Default region:

```text
eu-central-1
```

## Dashboard Offline Or API Errors

Check the Amplify app:

```powershell
aws amplify get-app --profile codex-terraform --region eu-central-1 --app-id d26sqdhjgzo06h
```

Check the API Gateway:

```powershell
aws apigatewayv2 get-api --profile codex-terraform --region eu-central-1 --api-id onbcgvleu4
```

Check recent Lambda errors:

```powershell
aws logs tail /aws/lambda/ht3storageretschwilDashboardApi --profile codex-terraform --region eu-central-1 --since 1h
aws logs tail /aws/lambda/storageretschwilPowerIoT --profile codex-terraform --region eu-central-1 --since 1h
```

## Measurement Alerts

Core function:

```text
ht3storageretschwilAlertChecker
```

Check logs:

```powershell
aws logs tail /aws/lambda/ht3storageretschwilAlertChecker --profile codex-terraform --region eu-central-1 --since 1h
```

Config table:

```text
storageretschwilconfig
```

Measurement table:

```text
ht3storageretschwildata
```

## Flood Alerts

Core function:

```text
storageretschwilFloodWebhook
```

Check logs:

```powershell
aws logs tail /aws/lambda/storageretschwilFloodWebhook --profile codex-terraform --region eu-central-1 --since 1h
```

## Video Detection

Upload bucket:

```text
camstorageretschwil
```

Pipeline functions:

```text
videorekostorageretschwilanalysis
videorekostorageretschwilcamevents
videorekostorageretschwilgetevents
videorekostorageretschwilDashboardVideoPlayer
videorekostorageretschwilDeleteEvents
```

Check recent S3 objects:

```powershell
aws s3api list-objects-v2 --profile codex-terraform --bucket camstorageretschwil --max-items 20
```

Check Rekognition event processing logs:

```powershell
aws logs tail /aws/lambda/videorekostorageretschwilcamevents --profile codex-terraform --region eu-central-1 --since 2h
```

## Power And Dehumidifier Controls

Core function:

```text
storageretschwilPowerIoT
```

Check logs:

```powershell
aws logs tail /aws/lambda/storageretschwilPowerIoT --profile codex-terraform --region eu-central-1 --since 1h
```

Current dashboard logic:

- Power values from Shelly are treated as absolute values because the Shelly device can report negative watt values for positive consumption.
- Dehumidifier state is inferred from the PlugS current power.
- ON target: click UniPlus switch and wait until measured power is above the configured ON threshold.
- OFF target: click UniPlus switch and wait until measured power is below the configured OFF threshold.

## Audit Costs

Core function:

```text
storageretschwilAuditCosts
```

Annual report:

```text
storageretschwilAnnualCostReport
storageretschwilAnnualCostReportJan1
```

Check logs:

```powershell
aws logs tail /aws/lambda/storageretschwilAuditCosts --profile codex-terraform --region eu-central-1 --since 1h
```

Cost scope:

```text
Only known Storage Retschwil AWS services are shown.
```

Cost Explorer service filter:

```text
AWS Amplify
AWS Cost Explorer
AWS IoT
AWS Lambda
AWS Secrets Manager
Amazon API Gateway
Amazon Cognito
Amazon DynamoDB
Amazon Elastic Compute Cloud - Compute
Amazon Rekognition
Amazon Simple Notification Service
Amazon Simple Storage Service
Amazon Virtual Private Cloud
AmazonCloudWatch
CloudWatch Events
EC2 - Other
```

Cost allocation tags remain documented, but are not sufficient for the dashboard total because AWS Cost Explorer and some shared charges are not reliably available through resource tags.

Resource tags were rechecked on `2026-07-16`. Missing standard tags were added to:

```text
EC2 root volume: vol-01cbc52c919ad7eef
EC2 primary network interface: eni-0b0545ae4a13cd5d9
EC2 security group: sg-093880d024847eeae
Elastic IP: eipalloc-078e5c839c505ac80
API Gateway default stage: onbcgvleu4/$default
CloudWatch log groups with missing Owner/ManagedBy/Name/Description tags
```

IoT `thing` and IoT certificate tagging was attempted, but AWS returned `Invalid resource type`; the IoT rule is tagged and IoT usage is included by service scope.

The daily cache key includes the service-scoped version:

```text
auditCostsDailyCache#storage-retschwil-services-v3#<yyyy-mm-dd>
```

`lastDay` prefers the latest completed/billable Cost Explorer day. The current UTC day can be returned by AWS as `Estimated` before usage has been rated, so it is intentionally skipped when it would show as an empty `CHF 0.00` current-day estimate.

After the `lastDay` correction on `2026-07-18`, the dashboard returned:

```text
Month to date: CHF 15.84
Last day: 2026-07-17 / CHF 0.19 / estimated
Top service: AWS Cost Explorer / CHF 9.38
Top service month estimate: CHF 16.16
```

The dashboard displays the fourth AWS cost card as a full Storage Retschwil month projection:

```text
monthEstimate = monthToDate / elapsedDays * daysInMonth
```

## Android Push Notifications

Core function:

```text
storageretschwilPushNotifications
```

Firebase project:

```text
storage-retschwil
```

Android package:

```text
one.ortus.storageretschwil
```

Token store:

```text
DynamoDB: storageretschwilconfig/androidPushTokens
```

Check push Lambda logs:

```powershell
aws logs tail /aws/lambda/storageretschwilPushNotifications --profile codex-terraform --region eu-central-1 --since 1h
```

Send a direct test push:

```powershell
aws lambda invoke --function-name storageretschwilPushNotifications --profile codex-terraform --region eu-central-1 --cli-binary-format raw-in-base64-out --payload '{\"title\":\"Storage Retschwil Alert\",\"body\":\"Android push test\",\"data\":{\"type\":\"test\"}}' response.json
```

FCM messages are sent as data-only payloads. This lets the Android app create the notification locally with `NotificationHelper`, so tapping the notification opens the Storage Retschwil app through `GateActivity`.

Measurement and flood alerts store the last sent alert signature in `storageretschwilconfig`. Identical alert values/states are suppressed until a relevant value changes.

## Metadata Audit

List all tagged project resources:

```powershell
aws resourcegroupstaggingapi get-resources --profile codex-terraform --region eu-central-1 --tag-filters Key=Project,Values=Storage-Retschwil
```

Runtime audit:

```powershell
aws lambda list-functions --profile codex-terraform --region eu-central-1 --query "Functions[].{Name:FunctionName,Runtime:Runtime,LastModified:LastModified}"
```

## Google Metadata Audit

Google project labels should include:

```text
project = storage-retschwil
storage_retschwil = true
managed_by = codex
owner = ip-skyit
```

Google Play listing should be maintained for:

```text
Title: Storage Retschwil
Short description: Private dashboard for Storage Retschwil monitoring, controls and alerts.
Contact email: ip@skyit.ch
Privacy policy: https://storageretschwil.ortus.one/privacy.html
```

Service account descriptions can be maintained after the Google IAM API is enabled for project `198845542006`.

Local Google Play Publisher API key:

```text
.local-secrets/google-play-publisher-service-account.json
```

Keep this file outside Git. It replaces ad-hoc references to files in the Windows Downloads folder.
