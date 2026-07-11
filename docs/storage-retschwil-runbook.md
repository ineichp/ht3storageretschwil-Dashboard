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

## Metadata Audit

List all tagged project resources:

```powershell
aws resourcegroupstaggingapi get-resources --profile codex-terraform --region eu-central-1 --tag-filters Key=Project,Values=Storage-Retschwil
```

Runtime audit:

```powershell
aws lambda list-functions --profile codex-terraform --region eu-central-1 --query "Functions[].{Name:FunctionName,Runtime:Runtime,LastModified:LastModified}"
```
