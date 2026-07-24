# JZ CentOS 部署说明

目标服务器：

- 云服务商：阿里云
- 操作系统：CentOS
- 公网 IP：`116.62.219.67`
- JZ 服务端口：`8766`

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

脚本会自动完成：

- 安装 Python、pip、rsync、curl、firewalld
- 创建运行用户 `jznotes`
- 同步程序到 `/opt/jz`
- 创建 Python 虚拟环境
- 安装服务端依赖
- 创建/保留 SQLite 数据库 `/opt/jz/jz.db`
- 创建环境文件 `/etc/jz-notes.env`
- 首次部署生成登录密码和 `JZ_AUTH_SECRET`
- 创建 systemd 服务 `jz-notes`
- 监听 `0.0.0.0:8766`
- 配置 CentOS 防火墙开放 `8766/tcp`
- 设置开机自启

## 3. 阿里云安全组

服务器系统防火墙可以由脚本配置，但阿里云安全组必须在阿里云控制台配置。

进入 ECS 实例对应的安全组，添加入方向规则：

```text
协议类型: 自定义 TCP
端口范围: 8766/8766
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
curl http://127.0.0.1:8766/ping
```

公网验证：

```bash
curl http://116.62.219.67:8766/ping
curl -I http://116.62.219.67:8766/ui/
```

也可以直接运行：

```bash
sudo bash /opt/jz/deploy/verify_server.sh
```

## 7. 浏览器访问地址

- 前端页面：`http://116.62.219.67:8766/ui/`
- API 文档：`http://116.62.219.67:8766/docs`
- 健康检查：`http://116.62.219.67:8766/ping`

## 8. 注意事项

- 当前服务使用 HTTP，不是 HTTPS。
- 当前数据库是 SQLite，适合个人使用。
- 不建议长期把 `8766` 对全公网开放；正式长期使用时建议限制来源 IP，或后续加 Nginx + HTTPS。
- `/etc/jz-notes.env` 权限为 `0600`，其中包含登录密码和会话密钥。
