# TeamAgent 部署指南

> 腾讯云服务器：root@118.195.138.220

---

## 一、本地准备

### 1. 清除测试数据（首次部署前执行一次）
```bash
node clean-db.mjs
```
清除所有用户、Agent、任务、工作区数据，保留数据库结构。

### 2. 提交代码
```bash
git add -A
git commit -m "ready for deploy"
git push
```

---

## 二、服务器环境配置（首次部署）

SSH 进入服务器：
```bash
ssh root@118.195.138.220
```

### 安装 Node.js（v18+）
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v  # 确认版本
```

### 安装 PostgreSQL
```bash
sudo apt-get install -y postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### 创建数据库
```bash
sudo -u postgres psql
CREATE USER teamagent WITH PASSWORD 'teamagent123';
CREATE DATABASE teamagent OWNER teamagent;
GRANT ALL PRIVILEGES ON DATABASE teamagent TO teamagent;
\q
```

### 安装 PM2（进程管理）
```bash
npm install -g pm2
```

---

## 三、部署应用

### 1. 拉取代码
```bash
cd /var/www
git clone https://github.com/ARplus/teamagent.git
cd teamagent
npm install
```

### 2. 配置环境变量
```bash
cp .env.example .env
nano .env
```

`.env` 内容（服务器版）：
```env
# 数据库
DATABASE_URL="postgresql://teamagent:teamagent123@localhost:5432/teamagent?schema=public"

# NextAuth
NEXTAUTH_URL="http://118.195.138.220:3000"
NEXTAUTH_SECRET="lobster-aurora-cosmic-artists-2026"

# AI - Claude（任务拆解、对话、评估）
ANTHROPIC_API_KEY="sk-ant-api03-你的key"
# ⚠️ 国内服务器必须设置代理，否则 Claude API 返回 403
ANTHROPIC_API_URL="https://anthropic-proxy.aurora-zhangjy.workers.dev/v1/messages"

# AI - 通义千问（Claude 不可用时自动降级）
QWEN_API_KEY="sk-4a673b39b21f4e2aad6b9e38f487631f"

# 文件上传本地存储路径
UPLOAD_DIR="/var/www/teamagent/uploads"
```

> ⚠️ 如果以后绑定域名，`NEXTAUTH_URL` 改成 `https://你的域名`

### 3. 创建上传目录
```bash
mkdir -p /var/www/teamagent/uploads
chmod 755 /var/www/teamagent/uploads
```

### 4. 初始化数据库
```bash
npx prisma generate
npx prisma db push
```

### 5. 构建应用
```bash
npm run build
```

### 6. 启动（PM2）
```bash
pm2 start npm --name "teamagent" -- start
pm2 save
pm2 startup  # 开机自启
```

---

## 四、验证

```bash
pm2 status          # 查看进程状态
pm2 logs teamagent  # 查看日志
curl http://localhost:3000/api/auth/session  # 测试接口
```

浏览器访问：http://118.195.138.220:3000

---

## 五、更新部署

本地改完代码后：
```bash
# 本地
git push

# 服务器
cd /var/www/teamagent
git pull
npm install            # 如果有新依赖
npx prisma db push     # 如果有 schema 变化
npm run build
pm2 restart teamagent
```

一键更新脚本（保存为 `/var/www/teamagent/deploy.sh`）：
```bash
#!/bin/bash
set -e
echo "=== TeamAgent 更新部署 ==="
cd /var/www/teamagent
git pull origin master
npm install
npx prisma db push
npx prisma generate
npm run build
pm2 restart teamagent
echo "=== 部署完成 ==="
```
使用：`bash deploy.sh`

---

## 六、Claude API 代理说明

国内服务器无法直连 `api.anthropic.com`（返回 403），通过 Cloudflare Worker 转发解决。

| 项目 | 值 |
|------|-----|
| 代理地址 | `https://anthropic-proxy.aurora-zhangjy.workers.dev` |
| 功能 | 转发 POST 请求到 api.anthropic.com |
| 免费额度 | 每天 10 万次请求 |
| 延迟增加 | ~50-100ms |
| Cloudflare 账号 | Aurora 的 Google 账号 |

### 环境变量配置

```bash
# 国内部署（腾讯云/阿里云等）必须设置
ANTHROPIC_API_URL="https://anthropic-proxy.aurora-zhangjy.workers.dev/v1/messages"

# 海外部署不用设，默认直连 api.anthropic.com
```

### AI 降级策略

代码中已实现自动降级：
1. **优先 Claude**（通过代理）→ 智能拆解、对话、评估
2. **降级千问**（直连阿里云）→ 基本可用，效果稍差
3. 如果两个都没 key → 返回错误提示

### 如需重新部署 Worker

**网页方式（推荐）：**
1. 登录 https://dash.cloudflare.com（Aurora 的 Google 账号）
2. 左侧 Workers & Pages → 点击 `anthropic-proxy`
3. Edit Code → 粘贴下面代码 → Deploy

```javascript
export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, x-api-key, anthropic-version",
        },
      });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const url = new URL(request.url);
    const targetUrl = "https://api.anthropic.com" + url.pathname + url.search;
    const headers = new Headers(request.headers);
    headers.set("Host", "api.anthropic.com");
    const response = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: request.body,
    });
    const respHeaders = new Headers(response.headers);
    respHeaders.set("Access-Control-Allow-Origin", "*");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders,
    });
  },
};
```

---

## 七、注意事项

| 项目 | 本地 | 服务器 |
|------|------|--------|
| DATABASE_URL | localhost:5432 | localhost:5432（服务器本地） |
| NEXTAUTH_URL | http://localhost:3000 | http://118.195.138.220:3000 |
| ANTHROPIC_API_URL | 可不设（VPN 直连） | **必须设代理** |
| 文件存储 | 相对路径 | /var/www/teamagent/uploads/ |
| 端口 | 3000 | 3000（可用 Nginx 反代到 80） |

---

## 八、Nginx 反向代理（绑域名时用）

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SSE 实时通知（必须关闭缓冲）
    location /api/events/subscribe {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }
}
```

---

## 九、常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| Claude API 返回 403 | 国内无法直连 Anthropic | 设置 `ANTHROPIC_API_URL` 为 Cloudflare 代理 |
| AI 拆解用了千问而不是 Claude | `ANTHROPIC_API_KEY` 未设置或无效 | 检查 Key，Claude 不可用时自动降级 |
| 数据库连接失败 | PostgreSQL 未启动或配置错误 | `systemctl status postgresql` 检查 |
| 构建失败 | Node.js 版本太低 | 确保 >= 18：`node -v` |
| SSE 实时通知不工作 | Nginx 缓冲未关闭 | 参考 Nginx 配置中 SSE 部分 |
| 文件上传失败 | 目录权限或 Nginx 限制 | 检查 uploads 目录权限 + `client_max_body_size` |
| PM2 重启后应用没起来 | 没执行 `pm2 save` | `pm2 save` 保存进程列表 |

---

*最后更新：2026-03-01 | 凯凯 🤖*
