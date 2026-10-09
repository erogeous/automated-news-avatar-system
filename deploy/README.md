# 服务器部署说明

建议服务器：Ubuntu 22.04 LTS、4 核 8 GB、50 GB SSD、5 Mbps 或以上公网带宽。

生产服务由两个仅在服务器内部通信的进程组成：

- Web 工作台：`0.0.0.0:3000`
- 媒体与素材服务：`127.0.0.1:3101`

Nginx 只向公网暴露 80/443。浏览器通过 `/api/media/*` 访问媒体服务，因此不会访问用户电脑的 `127.0.0.1`。

部署目录：

```text
/opt/news-avatar/app   程序
/opt/news-avatar/data  新项目、音频切片、下载素材和成片
```

安装步骤：

```bash
sudo apt update
sudo apt install -y nginx ca-certificates curl
# 安装 Node.js 22 LTS 后：
sudo useradd --system --home /opt/news-avatar --shell /usr/sbin/nologin newsavatar
sudo mkdir -p /opt/news-avatar/app /opt/news-avatar/data
sudo chown -R newsavatar:newsavatar /opt/news-avatar

cd /opt/news-avatar/app
cp .env.local.example .env.local
# 填写三个服务的 API Key 后：
npm ci
npm run build

sudo cp deploy/news-avatar.service /etc/systemd/system/
sudo cp deploy/nginx-news-avatar.conf /etc/nginx/sites-available/news-avatar
sudo ln -sfn /etc/nginx/sites-available/news-avatar /etc/nginx/sites-enabled/news-avatar
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable --now news-avatar nginx
```

验证：

```bash
curl http://127.0.0.1:3101/health
curl http://127.0.0.1:3000/api/media/health
curl -I http://127.0.0.1:3000/
```

绑定域名后使用 Certbot 配置 HTTPS。首次联调可以先使用公网 IP；域名不是启动服务的前置条件。
