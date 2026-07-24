#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="jz-notes"
APP_USER="jznotes"
APP_DIR="/opt/jz"
ENV_FILE="/etc/jz-notes.env"
PUBLIC_HOST="${PUBLIC_HOST:-116.62.219.67}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "请使用 root 或 sudo 执行：sudo bash deploy/restart_server.sh"
    exit 1
  fi
}

read_env_value() {
  local key="$1"
  if [ -f "${ENV_FILE}" ]; then
    grep -E "^${key}=" "${ENV_FILE}" | tail -n 1 | cut -d= -f2- || true
  fi
}

random_hex() {
  python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
}

PORT="$(read_env_value JZ_PORT || true)"
PORT="${PORT:-8766}"
DB_PATH="$(read_env_value JZ_DB_PATH || true)"
DB_PATH="${DB_PATH:-${APP_DIR}/jz.db}"
AUTH_USER="$(read_env_value JZ_AUTH_USER || true)"
AUTH_USER="${AUTH_USER:-admin}"
AUTH_PASSWORD="$(read_env_value JZ_AUTH_PASSWORD || true)"
AUTH_PASSWORD="${AUTH_PASSWORD:-$(random_hex | cut -c1-16)}"
AUTH_SECRET="$(read_env_value JZ_AUTH_SECRET || true)"
AUTH_SECRET="${AUTH_SECRET:-$(random_hex)}"

require_root

echo "==> 停止服务"
systemctl stop "${SERVICE_NAME}" >/dev/null 2>&1 || true

echo "==> 同步程序到 ${APP_DIR}"
mkdir -p "${APP_DIR}"
rsync -a --delete \
  --exclude '.venv' \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  --exclude 'jz.db*' \
  "${SRC_DIR}/" "${APP_DIR}/"

if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${APP_DIR}" --shell /sbin/nologin "${APP_USER}"
fi

python3 -m venv "${APP_DIR}/.venv"
"${APP_DIR}/.venv/bin/python" -m pip install --upgrade pip
"${APP_DIR}/.venv/bin/pip" install -r "${APP_DIR}/requirements-server.txt"

cat >"${ENV_FILE}" <<EOF
JZ_HOST=0.0.0.0
JZ_PORT=${PORT}
JZ_PUBLIC_BASE=http://${PUBLIC_HOST}:${PORT}
JZ_DB_PATH=${DB_PATH}
JZ_AUTH_ENABLED=1
JZ_AUTH_USER=${AUTH_USER}
JZ_AUTH_PASSWORD=${AUTH_PASSWORD}
JZ_AUTH_SECRET=${AUTH_SECRET}
PYTHONUNBUFFERED=1
EOF
chown root:root "${ENV_FILE}"
chmod 0600 "${ENV_FILE}"

cat >/etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=JZ Personal Notes FastAPI Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${APP_DIR}/.venv/bin/python ${APP_DIR}/server.py
Restart=always
RestartSec=5
KillSignal=SIGINT

[Install]
WantedBy=multi-user.target
EOF

mkdir -p "$(dirname "${DB_PATH}")"
touch "${DB_PATH}"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}" >/dev/null
systemctl restart "${SERVICE_NAME}"

echo "==> 等待服务启动"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/ping" >/dev/null 2>&1; then
    echo "重启完成： http://${PUBLIC_HOST}:${PORT}/ui/"
    exit 0
  fi
  sleep 1
done

echo "健康检查失败，最近日志："
journalctl -u "${SERVICE_NAME}" -n 80 --no-pager || true
exit 1
