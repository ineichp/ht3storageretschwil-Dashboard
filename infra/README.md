# Storage Retschwil Infrastructure Sources

This directory contains the production source for infrastructure components changed after the initial dashboard rollout.

## Lambda

- `lambda/storageretschwilPowerIoT/index.mjs`: batched Shelly Cloud v2 status with a short shared cache, rate-limit-safe controls, energy metrics, and Power IoT timer.
- `lambda/ht3storageretschwilAlertChecker/index.mjs`: measurement automation and changed-state device notifications.
- `lambda/storageretschwilPushNotifications/index.mjs`: Firebase delivery and stale-token cleanup.

Each Lambda archive must contain `index.mjs` at the ZIP root.

## Camera Upload

- `camera-upload/sync-cam-storage.sh`: fail-safe S3 synchronization.
- `camera-upload/root-crontab`: once-per-minute execution with a `flock` lock.

Production paths:

```text
/usr/local/bin/sync-cam-storage.sh
/var/log/sync-cam-storage.log
```

## IAM

- `iam/storageretschwilPushNotificationsPolicy.json`: least-privilege runtime policy for push delivery and invalid-token removal.

Secrets remain in AWS Secrets Manager or Lambda environment variables and are never stored in Git.
