# TeamAgent 私有化部署指南

> 🎯 **目标读者**：人类运维工程师 & AI Agent
> 
> 本指南将带你从零开始部署 TeamAgent，包括购买服务器、配置域名、安装应用、配置 HTTPS。
> 预计耗时：1-2 小时（人类）/ 10-30 分钟（Agent）

---

## 📋 目录

1. [准备工作](#1-准备工作)
2. [购买云服务器](#2-购买云服务器)
3. [连接服务器](#3-连接服务器)
4. [安装基础环境](#4-安装基础环境)
5. [部署 TeamAgent](#5-部署-teamagent)
6. [配置 Nginx](#6-配置-nginx)
7. [配置域名 DNS](#7-配置域名-dns)
8. [配置 Cloudflare CDN + SSL](#8-配置-cloudflare-cdn--ssl)
9. [验证部署](#9-验证部署)
10. [后续维护](#10-后续维护)

---

## 1. 准备工作

### 你需要准备

| 项目 | 说明 | 预估费用 |
|------|------|----------|
| 云服务器 | 腾讯云/阿里云/AWS 等 | ¥50-200/月 |
| 域名 | 任意域名注册商 | ¥10-100/年 |
| Cloudflare 账号 | 免费 | ¥0 |
| SSH 客户端 | Windows: PowerShell / Mac: Terminal | ¥0 |

### 推荐配置

| 规模 | CPU | 内存 | 硬盘 | 带宽 |
|------|-----|------|------|------|
| 小团队 (<10人) | 1核 | 2GB | 40GB | 1Mbps |
| 中团队 (10-50人) | 2核 | 4GB | 60GB | 3Mbps |
| 大团队 (50+人) | 4核 | 8GB | 100GB | 5Mbps |

---

## 2. 购买云服务器

### 腾讯云（推荐新手）

1. 访问 https://cloud.tencent.com
2. 注册/登录账号
3. 进入「云服务器 CVM」
4. 点击「新建」

**配置选择：**
```
地域：选择离用户近的（如：上海/北京/广州）
实例类型：标准型 S5
镜像：Ubuntu 22.04 LTS
系统盘：高性能云硬盘 50GB
网络：默认 VPC
公网 IP：分配独立公网 IP
带宽计费：按带宽计费，1-5Mbps
安全组：新建，开放 22/80/443 端口
登录方式：密钥对（推荐）或密码
```

5. 创建 SSH 密钥对，下载 `.pem` 文件（**务必保存好！**）
6. 确认订单，完成购买
7. 记录你的**公网 IP 地址**

### 阿里云

1. 访问 https://www.aliyun.com
2. 进入「云服务器 ECS」
3. 配置与腾讯云类似

### AWS（海外推荐）

1. 访问 https://aws.amazon.com
2. 进入「EC2」
3. 选择 Ubuntu 22.04 AMI

---

## 3. 连接服务器

### Windows (PowerShell)

```powershell
# 设置密钥文件权限（首次使用）
icacls "C:\path\to\your-key.pem" /inheritance:r /grant:r "$($env:USERNAME):R"

# SSH 连接
ssh -i "C:\path\to\your-key.pem" ubuntu@<你的服务器IP>
```

### Mac / Linux

```bash
# 设置密钥文件权限（首次使用）
chmod 400 ~/path/to/your-key.pem

# SSH 连接
ssh -i ~/path/to/your-key.pem ubuntu@<你的服务器IP>
```

### 验证连接成功

```bash
# 你应该看到类似这样的提示：
Welcome to Ubuntu 22.04 LTS
ubuntu@VM-0-5-ubuntu:~$
```

---

## 4. 安装基础环境

### 4.1 更新系统

```bash
sudo apt update && sudo apt upgrade -y
```

### 4.2 安装 Node.js 20.x

```bash
# 添加 NodeSource 仓库
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# 安装 Node.js
sudo apt install -y nodejs

# 验证安装
node -v  # 应显示 v20.x.x
npm -v   # 应显示 10.x.x
```

### 4.3 安装 PostgreSQL

```bash
# 安装 PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# 启动服务
sudo systemctl start postgresql
sudo systemctl enable postgresql

# 创建数据库和用户
sudo -u postgres psql << EOF
CREATE USER teamagent WITH PASSWORD 'your_secure_password_here';
CREATE DATABASE teamagent OWNER teamagent;
GRANT ALL PRIVILEGES ON DATABASE teamagent TO teamagent;
EOF

# 验证
sudo -u postgres psql -c "\l"  # 应显示 teamagent 数据库
```

> ⚠️ **安全提示**：请将 `your_secure_password_here` 替换为强密码！

### 4.4 安装 PM2（进程管理）

```bash
sudo npm install -g pm2
```

### 4.5 安装 Nginx

```bash
sudo apt install -y nginx
sudo systemctl start nginx
sudo systemctl enable nginx

# 验证
curl http://localhost  # 应显示 Welcome to nginx!
```

### 4.6 安装 Git

```bash
sudo apt install -y git
```

---

## 5. 部署 TeamAgent

### 5.1 克隆代码

```bash
cd ~
git clone https://github.com/your-org/teamagent.git
cd teamagent
```

### 5.2 安装依赖

```bash
npm install
```

### 5.3 配置环境变量

```bash
cp .env.example .env
nano .env
```

编辑 `.env` 文件：

```bash
# 数据库连接
DATABASE_URL="postgresql://teamagent:your_secure_password_here@localhost:5432/teamagent"

# NextAuth 配置
NEXTAUTH_URL="https://your-domain.com"
NEXTAUTH_SECRET="生成一个随机字符串"

# OpenAI API（可选，用于 AI 拆解）
OPENAI_API_KEY="sk-xxx"
```

生成 NEXTAUTH_SECRET：
```bash
openssl rand -base64 32
```

### 5.4 数据库迁移

```bash
npx prisma migrate deploy
```

### 5.5 构建应用

```bash
npm run build
```

### 5.6 启动应用

```bash
# 使用 PM2 启动
pm2 start npm --name "teamagent" -- start

# 设置开机自启
pm2 save
pm2 startup
# 按照提示执行生成的命令

# 查看状态
pm2 ls
```

### 5.7 验证应用运行

```bash
curl http://localhost:3000
# 应返回 HTML 内容
```

---

## 6. 配置 Nginx

### 6.1 创建配置文件

```bash
sudo nano /etc/nginx/sites-available/teamagent
```

写入以下内容（替换 `your-domain.com`）：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # SSE 支持（实时通知）
        proxy_buffering off;
        proxy_read_timeout 86400;
    }
}
```

### 6.2 启用配置

```bash
# 创建软链接
sudo ln -s /etc/nginx/sites-available/teamagent /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重载 Nginx
sudo systemctl reload nginx
```

---

## 7. 配置域名 DNS

### 7.1 获取服务器 IP

```bash
curl ifconfig.me
# 记录显示的 IP 地址
```

### 7.2 在域名注册商配置 DNS

> 以下以阿里云为例，其他注册商类似

1. 登录阿里云域名控制台
2. 找到你的域名，点击「解析」
3. 添加记录：
   - **记录类型**：A
   - **主机记录**：agent（或你想要的子域名）
   - **记录值**：你的服务器 IP
   - **TTL**：10 分钟

### 7.3 验证 DNS 生效

```bash
# 在本地电脑执行
nslookup agent.your-domain.com

# 应返回你的服务器 IP
```

> 💡 DNS 生效可能需要 5-30 分钟

---

## 8. 配置 Cloudflare CDN + SSL

> 🎯 **为什么用 Cloudflare**：免费 SSL 证书、全球 CDN 加速、DDoS 防护、绕过国内备案限制

### 8.1 注册 Cloudflare

1. 访问 https://dash.cloudflare.com/sign-up
2. 注册账号

### 8.2 添加域名

1. 点击「Add a Site」或「Connect a domain」
2. 输入你的域名（如 `your-domain.com`）
3. 选择「Free」计划
4. Cloudflare 会扫描现有 DNS 记录

### 8.3 添加 DNS 记录

在 Cloudflare DNS 页面添加：

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | agent | 你的服务器IP | ☁️ Proxied |

> ⚠️ **重要**：确保 Proxy 状态是橙色云朵（☁️），这样流量才会经过 Cloudflare

### 8.4 获取 Cloudflare NS 服务器

Cloudflare 会给你两个 NS 地址，类似：
```
xxx.ns.cloudflare.com
yyy.ns.cloudflare.com
```

### 8.5 修改域名 NS 服务器

回到你的域名注册商：

1. 找到「DNS 设置」或「Name Server 修改」
2. 将 NS 服务器改为 Cloudflare 提供的两个地址
3. 保存

> 💡 NS 切换可能需要 5 分钟到 48 小时（通常 30 分钟内）

### 8.6 配置 SSL

1. 在 Cloudflare 左侧菜单点击「SSL/TLS」
2. 选择「Overview」
3. 将模式设为「Flexible」

> **SSL 模式说明**：
> - **Flexible**：Cloudflare ↔ 用户 加密，Cloudflare ↔ 服务器 不加密
> - **Full**：两段都加密，但服务器证书可以自签名
> - **Full (Strict)**：两段都加密，服务器需要有效证书

### 8.7 等待证书颁发

1. 进入「SSL/TLS」→「Edge Certificates」
2. 等待证书状态变为「Active」
3. 通常几分钟内完成

---

## 9. 验证部署

### 9.1 检查 DNS

```bash
nslookup agent.your-domain.com
# 应返回 Cloudflare 的 IP（104.x.x.x 或 172.x.x.x）
```

### 9.2 访问网站

在浏览器打开：
```
https://agent.your-domain.com
```

### 9.3 检查 SSL

- 浏览器地址栏应显示 🔒 锁图标
- 点击锁图标，证书颁发者应为「Cloudflare」或「Let's Encrypt」

### 9.4 测试功能

1. 注册一个账号
2. 创建一个任务
3. 测试 AI 拆解（如果配置了 OpenAI）

---

## 10. 后续维护

### 10.1 更新代码

```bash
cd ~/teamagent
git pull
npm install
npm run build
pm2 restart teamagent
```

### 10.2 查看日志

```bash
# 应用日志
pm2 logs teamagent

# Nginx 日志
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### 10.3 数据库备份

```bash
# 备份
pg_dump -U teamagent teamagent > backup_$(date +%Y%m%d).sql

# 恢复
psql -U teamagent teamagent < backup_20260218.sql
```

### 10.4 监控服务状态

```bash
# 应用状态
pm2 status

# 系统资源
htop

# 磁盘空间
df -h
```

### 10.5 常见问题

| 问题 | 解决方案 |
|------|----------|
| 502 Bad Gateway | 检查 PM2 应用是否运行：`pm2 ls` |
| SSL 错误 | Cloudflare SSL 模式改为 Flexible |
| 数据库连接失败 | 检查 .env 中的 DATABASE_URL |
| 页面空白 | 查看日志：`pm2 logs teamagent` |

---

## 🎉 恭喜！

你已经成功部署了 TeamAgent！

**接下来你可以：**
- 邀请团队成员注册
- 创建工作区和任务
- 配置 AI 拆解功能
- 集成外部 Agent

---

## 📚 相关文档

- [SPEC.md](../SPEC.md) — 产品规格
- [DEPLOY.md](../DEPLOY.md) — 部署配置速查
- [README.md](../README.md) — 项目介绍

---

*万物互联的 GAIA 世界，被使用就是最大价值 🌍*

*TeamAgent by Aurora & Lobster 🦞*
