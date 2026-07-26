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
3. 打开“日志/技术博客”，新建一篇草稿文章。
4. 添加 H1/H2 标题、加粗文本、链接和代码块。
5. 保存后刷新页面，确认格式保留。
6. 发布文章，确认文章卡片显示“已发布”。
7. 切换阅读视图，确认目录和代码块显示正常。
8. 新建一个 Todo，完成后再重开。
9. 新建一条收入和一条支出流水。
10. 在记账页分别验证按月份、按年份、自定义日期范围筛选。
11. 确认摘要卡片、分类统计、账户统计和流水列表会一起更新。
