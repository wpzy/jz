# JZ CentOS 部署说明

目标服务器：

- 云服务商：阿里云
- 操作系统：CentOS
- 公网 IP：`116.62.219.67`
- JZ 服务端口：`8776`

该服务独立于现有 `profit_tracker`，不会占用 `8765`。

## 1. 上传代码

把 `/Users/bytedance/jz` 目录上传到服务器，例如：

```bash
scp -r /Users/bytedance/jz root@116.62.219.67:/root/jz
```

也可以通过 Git、SFTP 或堡垒机上传。

## 2. 一键部署

在服务器上执行：

```bash
cd /root/jz
sudo bash deploy/centos_install.sh
```

如果你已经手动安装了 Python 3.9+，也可以显式指定：

```bash
sudo PYTHON_BIN=/usr/local/bin/python3.9 bash deploy/centos_install.sh
```

脚本会自动完成：

- 安装 Python、pip、rsync、curl、firewalld 和编译依赖
- 自动选择/安装 Python 3.9+（CentOS 自带旧 Python 会导致 FastAPI 新版本无法安装）
- 创建运行用户 `jznotes`
- 同步程序到 `/opt/jz`
- 创建 Python 虚拟环境
- 安装服务端依赖
- 创建/保留 SQLite 数据库 `/opt/jz/jz.db`
- 创建环境文件 `/etc/jz-notes.env`
- 首次部署生成登录密码和 `JZ_AUTH_SECRET`
- 创建 systemd 服务 `jz-notes`
- 监听 `0.0.0.0:8776`
- 配置 CentOS 防火墙开放 `8776/tcp`
- 设置开机自启

## 3. 阿里云安全组

服务器系统防火墙可以由脚本配置，但阿里云安全组必须在阿里云控制台配置。

进入 ECS 实例对应的安全组，添加入方向规则：

```text
协议类型: 自定义 TCP
端口范围: 8776/8776
授权对象: 0.0.0.0/0
优先级: 默认即可
```

如果只允许固定网络访问，可以把 `0.0.0.0/0` 改成你的固定公网出口 IP。

## 4. 登录信息

部署脚本首次运行会生成密码，并写入：

```bash
sudo cat /etc/jz-notes.env
```

关注：

```text
JZ_AUTH_USER=admin
JZ_AUTH_PASSWORD=...
```

如需改密码，编辑 `/etc/jz-notes.env` 后重启：

```bash
sudo systemctl restart jz-notes
```

## 5. 启停命令

启动：

```bash
sudo bash /opt/jz/deploy/start_server.sh
```

停止：

```bash
sudo bash /opt/jz/deploy/stop_server.sh
```

重启/更新：

```bash
sudo bash /opt/jz/deploy/restart_server.sh
```

查看日志：

```bash
sudo journalctl -u jz-notes -f
```

查看状态：

```bash
sudo systemctl status jz-notes
```

## 6. 验证

服务器本机验证：

```bash
curl http://127.0.0.1:8776/ping
```

公网验证：

```bash
curl http://116.62.219.67:8776/ping
curl -I http://116.62.219.67:8776/ui/
```

也可以直接运行：

```bash
sudo bash /opt/jz/deploy/verify_server.sh
```

## 7. 浏览器访问地址

- 前端页面：`http://116.62.219.67:8776/ui/`
- API 文档：`http://116.62.219.67:8776/docs`
- 健康检查：`http://116.62.219.67:8776/ping`

## 8. Python 版本问题

如果安装依赖时报类似错误：

```text
ERROR: Could not find a version that satisfies the requirement fastapi<1,>=0.111
```

通常不是镜像源缺包，而是当前 `python3` 版本太旧。CentOS 7 自带 Python 3.6 时，pip 只能看到 FastAPI 0.83 及以前版本，因为更高版本不支持旧 Python。

解决方式：使用更新后的脚本重新部署：

```bash
cd /root/jz
sudo bash deploy/restart_server.sh
```

脚本会优先寻找 `python3.12/python3.11/python3.10/python3.9`，找不到时会编译安装 Python 3.9.18，并用它重建 `/opt/jz/.venv`。

如果旧环境文件里保留了已占用的 `JZ_PORT=8766`，新版 `restart_server.sh` 会自动迁移到默认端口 `8776`。如需指定其他端口，可以执行：

```bash
sudo JZ_PORT=8788 bash deploy/restart_server.sh
```

## 9. 注意事项

- 当前服务使用 HTTP，不是 HTTPS。
- 当前数据库是 SQLite，适合个人使用。
- 不建议长期把 `8776` 对全公网开放；正式长期使用时建议限制来源 IP，或后续加 Nginx + HTTPS。
- `/etc/jz-notes.env` 权限为 `0600`，其中包含登录密码和会话密钥。
