#!/bin/bash

# TeamAgent 一键部署脚本
# 适用于 Ubuntu 22.04

set -e

echo "🦞 TeamAgent 部署开始..."

# 更新系统
echo "📦 更新系统..."
apt update && apt upgrade -y

# 安装必要工具
echo "🔧 安装基础工具..."
apt install -y curl git nginx

# 安装 Node.js 20
echo "📗 安装 Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 安装 PostgreSQL
echo "🐘 安装 PostgreSQL..."
apt install -y postgresql postgresql-contrib

# 启动 PostgreSQL
systemctl start postgresql
systemctl enable postgresql

# 创建数据库和用户
echo "📊 配置数据库..."
sudo -u postgres psql -c "CREATE USER teamagent WITH PASSWORD 'teamagent2025';" || true
sudo -u postgres psql -c "CREATE DATABASE teamagent OWNER teamagent;" || true

# 克隆项目
echo "📥 克隆 TeamAgent..."
cd /opt
rm -rf teamagent
git clone https://github.com/ARplus/teamagent.git
cd teamagent

# 安装依赖
echo "📦 安装依赖..."
npm install

# 构建项目
echo "🔨 构建项目..."
npm run build

# 创建 systemd 服务
echo "⚙️ 配置系统服务..."
cat > /etc/systemd/system/teamagent.service << 'EOF'
[Unit]
Description=TeamAgent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/teamagent
ExecStart=/usr/bin/npm start
Restart=on-failure
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
EOF

# 启动服务
systemctl daemon-reload
systemctl enable teamagent
systemctl start teamagent

# 配置 Nginx
echo "🌐 配置 Nginx..."
cat > /etc/nginx/sites-available/teamagent << 'EOF'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

ln -sf /etc/nginx/sites-available/teamagent /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo ""
echo "✅ TeamAgent 部署完成！"
echo ""
echo "🌐 访问地址: http://$(curl -s ifconfig.me)"
echo ""
echo "🦞 Enjoy!"
