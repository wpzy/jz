#!/usr/bin/env bash
set -euo pipefail

APP_NAME="JZ 个人记事"
SERVICE_NAME="jz-notes"
APP_USER="jznotes"
APP_DIR="/opt/jz"
ENV_FILE="/etc/jz-notes.env"
DB_PATH="${APP_DIR}/jz.db"
PUBLIC_HOST="${PUBLIC_HOST:-116.62.219.67}"
PORT="${JZ_PORT:-8766}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "请使用 root 或 sudo 执行：sudo bash deploy/centos_install.sh"
    exit 1
  fi
}

random_hex() {
  python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
}

read_env_value() {
  local key="$1"
  if [ -f "${ENV_FILE}" ]; then
    grep -E "^${key}=" "${ENV_FILE}" | tail -n 1 | cut -d= -f2- || true
  fi
}

install_packages() {
  echo "==> 安装系统依赖"
  if command -v dnf >/dev/null 2>&1; then
    dnf install -y python3 python3-pip rsync curl firewalld
  elif command -v yum >/dev/null 2>&1; then
    yum install -y python3 python3-pip rsync curl firewalld
  else
    echo "未检测到 dnf/yum，请手动安装 python3 python3-pip rsync curl firewalld"
    exit 1
  fi
}

ensure_user() {
  echo "==> 创建运行用户 ${APP_USER}"
  if ! id "${APP_USER}" >/dev/null 2>&1; then
    useradd --system --home-dir "${APP_DIR}" --shell /sbin/nologin "${APP_USER}"
  fi
}

sync_app() {
  echo "==> 同步程序到 ${APP_DIR}"
  mkdir -p "${APP_DIR}"
  rsync -a --delete \
    --exclude '.venv' \
    --exclude '__pycache__' \
    --exclude '*.pyc' \
    --exclude 'jz.db*' \
    "${SRC_DIR}/" "${APP_DIR}/"
}

install_python_deps() {
  echo "==> 创建虚拟环境并安装依赖"
  python3 -m venv "${APP_DIR}/.venv"
  "${APP_DIR}/.venv/bin/python" -m pip install --upgrade pip
  "${APP_DIR}/.venv/bin/pip" install -r "${APP_DIR}/requirements-server.txt"
}

write_env() {
  echo "==> 写入环境配置 ${ENV_FILE}"
  local auth_secret auth_password auth_user
  auth_secret="$(read_env_value JZ_AUTH_SECRET || true)"
  if [ -z "${auth_secret}" ]; then
    auth_secret="$(random_hex)"
  fi
  auth_password="$(read_env_value JZ_AUTH_PASSWORD || true)"
  if [ -z "${auth_password}" ]; then
    auth_password="$(random_hex | cut -c1-16)"
    echo "首次部署生成登录密码：${auth_password}"
  fi
  auth_user="$(read_env_value JZ_AUTH_USER || true)"
  if [ -z "${auth_user}" ]; then
    auth_user="admin"
  fi

  cat >"${ENV_FILE}" <<EOF
JZ_HOST=0.0.0.0
JZ_PORT=${PORT}
JZ_PUBLIC_BASE=http://${PUBLIC_HOST}:${PORT}
JZ_DB_PATH=${DB_PATH}
JZ_AUTH_ENABLED=1
JZ_AUTH_USER=${auth_user}
JZ_AUTH_PASSWORD=${auth_password}
JZ_AUTH_SECRET=${auth_secret}
PYTHONUNBUFFERED=1
EOF
  chown root:root "${ENV_FILE}"
  chmod 0600 "${ENV_FILE}"
}

write_systemd() {
  echo "==> 写入 systemd 服务"
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
}

open_firewall() {
  echo "==> 配置 CentOS 防火墙端口 ${PORT}/tcp"
  systemctl enable --now firewalld >/dev/null 2>&1 || true
  if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active firewalld >/dev/null 2>&1; then
    firewall-cmd --permanent --add-port="${PORT}/tcp" >/dev/null
    firewall-cmd --reload >/dev/null
  else
    echo "未检测到可用 firewalld，请确认服务器安全策略已开放 ${PORT}/tcp"
  fi
}

wait_for_local_ping() {
  echo "==> 等待服务启动"
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${PORT}/ping" >/dev/null 2>&1; then
      echo "本机健康检查通过"
      return 0
    fi
    sleep 1
  done
  echo "健康检查失败，最近日志："
  journalctl -u "${SERVICE_NAME}" -n 80 --no-pager || true
  exit 1
}

require_root
install_packages
ensure_user
sync_app
install_python_deps
mkdir -p "$(dirname "${DB_PATH}")"
touch "${DB_PATH}"
write_env
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
write_systemd
open_firewall

echo "==> 启动并设置开机自启"
systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}"
wait_for_local_ping

cat <<EOF

部署完成。

公网访问地址:
  http://${PUBLIC_HOST}:${PORT}/ui/
  http://${PUBLIC_HOST}:${PORT}/docs
  http://${PUBLIC_HOST}:${PORT}/ping

登录信息保存在 ${ENV_FILE}：
  JZ_AUTH_USER
  JZ_AUTH_PASSWORD

重要：还需要在阿里云控制台为当前 ECS 安全组放行入方向 TCP ${PORT}。
EOF
