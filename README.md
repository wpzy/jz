# JZ 个人记事

一个独立部署的个人 Web 工具，支持：

- 写日志/日记：日期、标题、正文、心情、标签、搜索和筛选。
- 记 Todo：任务、备注、优先级、截止日期、完成/重开/删除。
- 记账：收入/支出流水、账户、分类、月度汇总、分类统计、账户统计。
- 简单密码访问：用户名/密码登录，使用 HTTP-only Cookie 保存会话。

## 技术栈

- 后端：FastAPI + Uvicorn
- 数据库：SQLite
- 前端：原生 HTML/CSS/JavaScript，静态文件由 FastAPI 提供
- 部署：CentOS + systemd，默认端口 `8766`

## 本地启动

```bash
cd /Users/bytedance/jz
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements-server.txt
JZ_AUTH_PASSWORD=change-me JZ_AUTH_SECRET=dev-secret python server.py
```

访问：

- 前端：<http://127.0.0.1:8766/ui/>
- 登录用户：`admin`
- 登录密码：`change-me`
- 健康检查：<http://127.0.0.1:8766/ping>

## 生产部署

目标服务器沿用现有阿里云 ECS/CentOS 环境，建议独立端口：

- 公网 IP：`116.62.219.67`
- JZ 服务端口：`8766`
- systemd 服务：`jz-notes`
- 服务器目录：`/opt/jz`
- 环境文件：`/etc/jz-notes.env`
- 数据库：`/opt/jz/jz.db`

详见 [DEPLOY_CENTOS.md](DEPLOY_CENTOS.md)。

## 环境变量

参考 `.env.example`：

```text
JZ_HOST=127.0.0.1
JZ_PORT=8766
JZ_PUBLIC_BASE=http://127.0.0.1:8766
JZ_DB_PATH=./jz.db
JZ_AUTH_ENABLED=1
JZ_AUTH_USER=admin
JZ_AUTH_PASSWORD=change-me
JZ_AUTH_SECRET=replace-with-random-hex
```

生产环境请务必设置强密码和随机 `JZ_AUTH_SECRET`。
