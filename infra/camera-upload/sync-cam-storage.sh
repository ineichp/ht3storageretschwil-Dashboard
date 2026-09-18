#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="/srv/cam/"
TARGET_BUCKET="s3://camstorageretschwil/"

# Only remove local files after the complete S3 sync succeeds.
/usr/bin/aws s3 sync "$SOURCE_DIR" "$TARGET_BUCKET"
/usr/bin/find "$SOURCE_DIR" -type f -mmin +10 -delete
