# Storage Retschwil AWS Operations

## Purpose

Storage Retschwil is the AWS-backed dashboard and automation stack for camera upload handling, HT3 measurements, Shelly Flood status, Shelly power controls, WhatsApp alerts, and audit cost reporting.

## Naming Convention

Use this naming style for AWS resource names and `Name` tags:

```text
StorageRetschwil-<Domain>-<Purpose><ResourceType>
```

Examples:

```text
StorageRetschwil-Camera-VideoBucket
StorageRetschwil-Camera-ProcessEventsFunction
StorageRetschwil-Ht3-MeasurementsTable
StorageRetschwil-Control-PowerDevicesFunction
StorageRetschwil-Iam-AuditCostsRole
StorageRetschwil-Logs-FloodWebhook
```

Use lowercase legacy names only where AWS resource renaming would risk breaking integrations.

## Required Tags

Every Storage Retschwil resource should carry these tags:

```text
Name = StorageRetschwil-<Domain>-<Purpose><ResourceType>
Project = Storage-Retschwil
Storage-Retschwil = true
ManagedBy = Terraform
Owner = Codex
Description = Short operational description
```

For every infrastructure or app change, update metadata and documentation in the same working session:

```text
AWS: Name, Project, Storage-Retschwil, ManagedBy, Owner, Description
Google: project labels, Play listing metadata, service account descriptions where supported
GitHub: architecture, runbook, operations notes, changelog
```

## Resource Groups

The main resource group is:

```text
Storage-Retschwil
```

It is tag-based and should include resources with:

```text
Project = Storage-Retschwil
Storage-Retschwil = true
```

The `terraform` group is used for resources managed or prepared for Terraform.

## Main Components

### Frontend

- Amplify app: `ht3storageretschwil-Dashboard`
- Purpose: hosts the Storage Retschwil dashboard frontend.

### Authentication

- Cognito user pool: `storageretschwil-dashboard-users`
- Purpose: dashboard login and MFA.

### Measurements

- DynamoDB table: `ht3storageretschwildata`
- Lambda: `ht3storageretschwilDashboardApi`
- Lambda: `ht3storageretschwilAlertChecker`
- IoT rule: `ht3storageretschwil_catch_temperature_humidity`

### Camera And Rekognition

- S3 bucket: `camstorageretschwil`
- Lambda: `videorekostorageretschwilanalysis`
- Lambda: `videorekostorageretschwilcamevents`
- Lambda: `videorekostorageretschwilgetevents`
- Lambda: `videorekostorageretschwilDashboardVideoPlayer`
- Lambda: `videorekostorageretschwilDeleteEvents`
- SNS topic: `videorekostroageretschwil`

### Flood And Power Controls

- Lambda: `storageretschwilFloodWebhook`
- Lambda: `storageretschwilPowerIoT`
- DynamoDB table: `storageretschwilconfig`

### Costs

- Lambda: `storageretschwilAuditCosts`
- Lambda: `storageretschwilAnnualCostReport`
- EventBridge rule: `storageretschwilAnnualCostReportJan1`

### Tagging Notes

Some AWS cost line items are usage-based and do not map cleanly to resource tags in Cost Explorer:

```text
AWS Cost Explorer API usage
Amazon Rekognition video job usage
AWS IoT message/rule usage
API Gateway request usage
Some VPC/EC2 shared or network usage
```

Where supported, the underlying resources should still carry the standard Storage Retschwil tags. The dashboard cost calculation uses a service-scope filter for these services so untaggable project usage remains visible.

Recently verified/tagged supporting resources:

```text
StorageRetschwil-Camera-UploadServerRootVolume
StorageRetschwil-Camera-UploadServerNetworkInterface
StorageRetschwil-Camera-UploadServerSecurityGroup
StorageRetschwil-Camera-UploadServerElasticIp
StorageRetschwil-Api-DashboardDefaultStage
StorageRetschwil-Iot-Ht3MeasurementsRule
StorageRetschwil-Logs-PowerIoT
```

AWS IoT returned `Invalid resource type` for direct tagging of the `thing/ht3storageretschwil` and its certificate through the current tagging API. The IoT rule is tagged and IoT costs remain included through service-scope cost reporting.

## Operational Notes

- Do not rename existing AWS resource IDs casually. Prefer fixing the `Name` tag first.
- Legacy typo resources such as `videorekostroageretschwil` should only be renamed through a planned migration because SNS topics and IAM policies can be referenced by ARN.
- CloudWatch log groups can remain tagged even for removed legacy functions until deletion is explicitly approved.
- Runtime upgrades should be checked with:

```powershell
aws lambda list-functions --profile codex-terraform --region eu-central-1 --query "Functions[].{Name:FunctionName,Runtime:Runtime}"
```

## Metadata Audit Commands

List project resources through tags:

```powershell
aws resourcegroupstaggingapi get-resources --profile codex-terraform --region eu-central-1 --tag-filters Key=Project,Values=Storage-Retschwil
```

Check IAM roles:

```powershell
aws iam list-roles --profile codex-terraform --query "Roles[?contains(RoleName, 'storage') || contains(RoleName, 'retschwil') || contains(RoleName, 'ht3') || contains(RoleName, 'videoreko')].{RoleName:RoleName,Description:Description,Tags:Tags}"
```

Check local IAM policies:

```powershell
aws iam list-policies --profile codex-terraform --scope Local --query "Policies[?contains(PolicyName, 'StorageRetschwil') || contains(PolicyName, 'storageretschwil') || contains(PolicyName, 'ht3') || contains(PolicyName, 'videoreko')].{PolicyName:PolicyName,Arn:Arn}"
```
