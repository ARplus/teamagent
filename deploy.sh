#!/bin/bash
# ============================================================
#  TeamAgent 一键部署脚本
#  用法: bash deploy.sh [--skill] [--static] [--app] [--all]
#  默认: --all (执行全部步骤)
# ============================================================
set -e

# ── 配置 ──
SERVER="ubuntu@118.195.138.220"
REMOTE_DIR="~/teamagent"
NGINX_STATIC="/var/www/static"
SKILL_SRC="skills/teamagent-client-skill-v2/teamagent-client-skill"
ZIP_OUT="public/downloads/teamagent-client-skill.zip"

# ── 颜色 ──
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}[OK]${NC} $1"; }
info() { echo -e "  ${YELLOW}[..]${NC} $1"; }
err()  { echo -e "  ${RED}[!!]${NC} $1"; }
step() { echo -e "\n${CYAN}════════════════════════════════════════${NC}"; echo -e "${CYAN}  $1${NC}"; echo -e "${CYAN}════════════════════════════════════════${NC}"; }

# ── 参数解析 ──
DO_SKILL=false
DO_STATIC=false
DO_APP=false

if [ $# -eq 0 ]; then
  DO_SKILL=true; DO_STATIC=true; DO_APP=true
fi

for arg in "$@"; do
  case $arg in
    --skill)  DO_SKILL=true ;;
    --static) DO_STATIC=true ;;
    --app)    DO_APP=true ;;
    --all)    DO_SKILL=true; DO_STATIC=true; DO_APP=true ;;
    --help|-h)
      echo "用法: bash deploy.sh [--skill] [--static] [--app] [--all]"
      echo "  --skill   打包 Skill ZIP"
      echo "  --static  同步静态文件到服务器 nginx 目录"
      echo "  --app     部署应用代码 (build + restart)"
      echo "  --all     全部执行 (默认)"
      exit 0 ;;
    *) err "未知参数: $arg"; exit 1 ;;
  esac
done

echo -e "\n🦞 ${GREEN}TeamAgent Deploy${NC}"
echo -e "   skill=$DO_SKILL  static=$DO_STATIC  app=$DO_APP\n"

# ============================================================
# Step 1: 打包 Skill ZIP
# ============================================================
if [ "$DO_SKILL" = true ]; then
  step "Step 1: 打包 Skill ZIP"

  if [ ! -d "$SKILL_SRC" ]; then
    err "Skill 源目录不存在: $SKILL_SRC"
    exit 1
  fi

  # 清理旧 ZIP
  rm -f "$ZIP_OUT"

  # 从 skills/teamagent-client-skill-v2/ 目录打包
  info "打包 $SKILL_SRC → $ZIP_OUT"
  cd skills/teamagent-client-skill-v2
  zip -r "../../$ZIP_OUT" teamagent-client-skill/ -x "*.DS_Store" "*__MACOSX*"
  cd ../..

  # 复制到 static 目录
  cp "$ZIP_OUT" "public/static/teamagent-client-skill.zip"

  # 验证
  ZIP_SIZE=$(stat -f%z "$ZIP_OUT" 2>/dev/null || stat -c%s "$ZIP_OUT" 2>/dev/null)
  ZIP_COUNT=$(unzip -l "$ZIP_OUT" 2>/dev/null | tail -1 | awk '{print $2}')
  if [ "$ZIP_SIZE" -gt 10000 ]; then
    ok "ZIP 打包成功: ${ZIP_SIZE} bytes, ${ZIP_COUNT} 文件"
  else
    err "ZIP 文件太小 (${ZIP_SIZE} bytes)，可能打包失败"
    exit 1
  fi
fi

# ============================================================
# Step 2: 同步静态文件到服务器
# ============================================================
if [ "$DO_STATIC" = true ]; then
  step "Step 2: 同步静态文件到服务器"

  # SCP 到项目目录
  info "SCP → $SERVER:$REMOTE_DIR/public/static/"
  scp public/static/install.ps1 "$SERVER:$REMOTE_DIR/public/static/"
  scp public/static/install.sh  "$SERVER:$REMOTE_DIR/public/static/" 2>/dev/null || true
  scp public/static/teamagent-client-skill.zip "$SERVER:$REMOTE_DIR/public/static/"
  scp "$ZIP_OUT" "$SERVER:$REMOTE_DIR/public/downloads/teamagent-client-skill.zip" 2>/dev/null || true

  # 关键：复制到 nginx 实际服务目录
  info "同步到 nginx 目录: $NGINX_STATIC"
  ssh "$SERVER" "sudo cp $REMOTE_DIR/public/static/install.ps1 $NGINX_STATIC/ && \
                 sudo cp $REMOTE_DIR/public/static/install.sh $NGINX_STATIC/ 2>/dev/null; \
                 sudo cp $REMOTE_DIR/public/static/teamagent-client-skill.zip $NGINX_STATIC/"

  # 验证
  info "验证文件可访问..."
  HTTP_CODE=$(curl -sI "https://agent.avatargaia.top/static/install.ps1" | head -1 | awk '{print $2}')
  if [ "$HTTP_CODE" = "200" ]; then
    ok "install.ps1 可访问 (HTTP $HTTP_CODE)"
  else
    err "install.ps1 访问失败 (HTTP $HTTP_CODE)"
  fi

  HTTP_CODE=$(curl -sI "https://agent.avatargaia.top/static/teamagent-client-skill.zip" | head -1 | awk '{print $2}')
  if [ "$HTTP_CODE" = "200" ]; then
    ok "skill ZIP 可访问 (HTTP $HTTP_CODE)"
  else
    err "skill ZIP 访问失败 (HTTP $HTTP_CODE)"
  fi
fi

# ============================================================
# Step 3: 部署应用代码
# ============================================================
if [ "$DO_APP" = true ]; then
  step "Step 3: 部署应用代码"

  info "远程构建中 (prisma generate + npm run build)..."
  ssh "$SERVER" "cd $REMOTE_DIR && npx prisma generate && npm run build 2>&1 | tail -3"

  info "重启 pm2..."
  ssh "$SERVER" "cd $REMOTE_DIR && pm2 restart teamagent"

  # 等待启动
  sleep 3

  # 验证
  info "验证应用状态..."
  PM2_STATUS=$(ssh "$SERVER" "pm2 jlist 2>/dev/null | node -e \"process.stdin.on('data',d=>{const j=JSON.parse(d);console.log(j[0]?.pm2_env?.status||'unknown')})\"" 2>/dev/null || echo "unknown")
  if [ "$PM2_STATUS" = "online" ]; then
    ok "应用运行正常 (status: online)"
  else
    err "应用状态异常: $PM2_STATUS"
  fi
fi

# ============================================================
# 完成
# ============================================================
echo ""
echo -e "🦞 ${GREEN}部署完成！${NC}"
echo -e "   站点: https://agent.avatargaia.top"
echo ""
