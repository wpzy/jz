#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="jz-notes"
sudo systemctl stop "${SERVICE_NAME}"
echo "${SERVICE_NAME} 已停止"
