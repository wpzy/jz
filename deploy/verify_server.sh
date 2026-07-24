#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="jz-notes"
PUBLIC_HOST="${PUBLIC_HOST:-116.62.219.67}"
PORT="${JZ_PORT:-8766}"

check() {
  local url="$1"
  echo "==> ${url}"
  curl -fsS "${url}" >/dev/null
}

check "http://127.0.0.1:${PORT}/ping"
check "http://${PUBLIC_HOST}:${PORT}/ping"

echo "==> http://${PUBLIC_HOST}:${PORT}/ui/"
curl -fsSI "http://${PUBLIC_HOST}:${PORT}/ui/" >/dev/null || true

echo "验证完成："
echo "  http://${PUBLIC_HOST}:${PORT}/ui/"
echo "  http://${PUBLIC_HOST}:${PORT}/ping"
echo ""
echo "服务状态："
systemctl status "${SERVICE_NAME}" --no-pager || true
