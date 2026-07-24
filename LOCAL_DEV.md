# 本地开发

## 安装依赖

需要 Python 3.9+。如果 `python3 --version` 小于 3.9，请改用 `python3.9`、`python3.10` 或更新版本。

```bash
cd /Users/bytedance/jz
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements-server.txt
```

## 启动

```bash
JZ_HOST=127.0.0.1 \
JZ_PORT=8776 \
JZ_DB_PATH=./jz.db \
JZ_AUTH_USER=admin \
JZ_AUTH_PASSWORD=change-me \
JZ_AUTH_SECRET=dev-secret \
python server.py
```

访问：

- 前端：<http://127.0.0.1:8776/ui/>
- API 文档：<http://127.0.0.1:8776/docs>
- 健康检查：<http://127.0.0.1:8776/ping>

## 常用验证

```bash
curl http://127.0.0.1:8776/ping
```

浏览器验证：

1. 打开 `/ui/`，应跳转到 `/login`。
2. 使用 `admin` / `change-me` 登录。
3. 新建一篇日志。
4. 新建一个 Todo，完成后再重开。
5. 新建一条收入和一条支出流水。
6. 检查首页和记账页的月度统计是否更新。
