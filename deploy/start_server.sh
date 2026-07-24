#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="jz-notes"

if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl start "${SERVICE_NAME}"
  sudo systemctl status "${SERVICE_NAME}" --no-pager
else
  echo "systemctl 不可用，请在 CentOS 服务器上运行。"
  exit 1
fi
