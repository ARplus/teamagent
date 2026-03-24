#!/bin/bash
# ============================================================
#  OpenClaw One-Click Installer (macOS / Linux)
#  Powered by Gaia Team
# ============================================================

set -e

# ---- Colors ----
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
MAGENTA='\033[0;35m'
GRAY='\033[0;90m'
WHITE='\033[0;97m'
NC='\033[0m'

# ---- Helpers ----
step() { echo -e "\n${CYAN}========================================${NC}\n${CYAN}  Step $1 - $2${NC}\n${CYAN}========================================${NC}"; }
ok()   { echo -e "  ${GREEN}[OK]${NC} $1"; }
info() { echo -e "  ${YELLOW}[..]${NC} $1"; }
err()  { echo -e "  ${RED}[!!]${NC} $1"; }

confirm() {
    echo -e "\n  ${WHITE}$1${NC}"
    read -r -p "  Press Enter to continue, or 'q' to quit: " key < /dev/tty
    if [ "$key" = "q" ]; then
        echo -e "  ${YELLOW}Exited.${NC}"
        exit 0
    fi
}

# ---- Welcome ----
clear
echo -e "\n  ${MAGENTA}OpenClaw One-Click Installer${NC}"
echo -e "  ${MAGENTA}=============================${NC}\n"
echo -e "  ${WHITE}This script will:${NC}"
echo -e "  ${GRAY}  1. Check / Install Node.js${NC}"
echo -e "  ${GRAY}  2. Install OpenClaw CLI${NC}"
echo -e "  ${GRAY}  3. Configure AI Token${NC}"
echo -e "  ${GRAY}  4. Start OpenClaw Gateway${NC}"
echo -e "  ${GRAY}  5. Open Chat Window${NC}\n"
echo -e "  ${GRAY}Just press Enter at each step.${NC}\n"

confirm "Ready?"

# ============================================================
# Step 1: Check / Install Node.js
# ============================================================
step 1 "Check Node.js"

NODE_OK=false
if command -v node &>/dev/null; then
    NODE_VER=$(node --version 2>/dev/null)
    MAJOR=$(echo "$NODE_VER" | sed 's/v\([0-9]*\).*/\1/')
    if [ "$MAJOR" -ge 22 ] 2>/dev/null; then
        ok "Node.js $NODE_VER installed (>= 22)"
        NODE_OK=true
    else
        info "Node.js $NODE_VER is too old, need >= 22"
    fi
fi

if [ "$NODE_OK" = false ]; then
    info "Need to install Node.js 22+..."

    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command -v brew &>/dev/null; then
            confirm "Will install Node.js 22 via Homebrew. OK?"
            info "Installing Node.js via Homebrew..."
            brew install node@22
            brew link --overwrite node@22 2>/dev/null || true
        else
            confirm "Will install Homebrew first, then Node.js. OK?"
            info "Installing Homebrew..."
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
            # Add brew to PATH for Apple Silicon
            if [ -f /opt/homebrew/bin/brew ]; then
                eval "$(/opt/homebrew/bin/brew shellenv)"
            fi
            info "Installing Node.js via Homebrew..."
            brew install node@22
            brew link --overwrite node@22 2>/dev/null || true
        fi
    else
        # Linux
        confirm "Will install Node.js 22 via NodeSource. OK?"
        info "Installing Node.js via NodeSource..."
        if command -v apt-get &>/dev/null; then
            curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
            sudo apt-get install -y nodejs
        elif command -v yum &>/dev/null; then
            curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
            sudo yum install -y nodejs
        else
            err "Unsupported package manager. Please install Node.js 22+ manually."
            exit 1
        fi
    fi

    NODE_VER=$(node --version 2>/dev/null)
    if [ -n "$NODE_VER" ]; then
        ok "Node.js $NODE_VER installed successfully!"
    else
        err "Node.js installation failed. Please install manually from https://nodejs.org/"
        exit 1
    fi
fi

confirm "Node.js ready. Install OpenClaw?"

# ============================================================
# Step 1.5: Check Git
# ============================================================
if ! command -v git &>/dev/null; then
    info "Git not found. Installing..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS: xcode-select installs git
        xcode-select --install 2>/dev/null || true
        info "Please complete the Xcode Command Line Tools installation if prompted, then re-run this script."
        exit 0
    else
        if command -v apt-get &>/dev/null; then
            sudo apt-get install -y git
        elif command -v yum &>/dev/null; then
            sudo yum install -y git
        fi
    fi
fi

# Force HTTPS for GitHub (avoid SSH key issues)
git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" 2>/dev/null
git config --global url."https://github.com/".insteadOf "git@github.com:" 2>/dev/null

# ============================================================
# Step 2: Install OpenClaw CLI
# ============================================================
step 2 "Install OpenClaw CLI"

CLAW_INSTALLED=false
TARGET_VER="2026.3.13"
if command -v openclaw &>/dev/null; then
    CLAW_VER=$(openclaw --version 2>/dev/null)
    if echo "$CLAW_VER" | grep -q "$TARGET_VER"; then
        ok "OpenClaw $CLAW_VER already installed"
        CLAW_INSTALLED=true
    elif [ -n "$CLAW_VER" ]; then
        info "[UPGRADE] OpenClaw $CLAW_VER -> $TARGET_VER"
    fi
fi

if [ "$CLAW_INSTALLED" = false ]; then
    info "Installing OpenClaw via npm..."
    info "(This may take a few minutes, please wait...)"

    # Use China npm mirror if in China (check by trying npmmirror)
    npm config set registry https://registry.npmmirror.com 2>/dev/null

    npm install -g openclaw@2026.3.13 2>&1 | while IFS= read -r line; do
        if [[ "$line" != npm\ warn* ]]; then
            echo -e "  ${GRAY}$line${NC}"
        fi
    done

    CLAW_VER=$(openclaw --version 2>/dev/null)
    if [ -n "$CLAW_VER" ]; then
        ok "OpenClaw $CLAW_VER installed successfully!"
    else
        err "OpenClaw installation failed. Check your network and retry."
        exit 1
    fi
fi

confirm "OpenClaw ready. Configure AI Token?"

# ============================================================
# Step 3: Configure AI Token
# ============================================================
step 3 "Configure Token"

echo ""
echo -e "  ${WHITE}Please enter your TeamAgent Token.${NC}"
echo -e "  ${GRAY}Token can be found at: https://agent.avatargaia.top -> Settings${NC}"
echo -e "  ${GRAY}(Register first if you don't have one)${NC}"
echo ""
read -r -p "  Token (ta_xxx): " API_KEY < /dev/tty

if [ -z "$API_KEY" ]; then
    err "Token is required. Please register at https://agent.avatargaia.top first."
    exit 1
fi

case "$API_KEY" in
    ta_*)
        # TeamAgent Token -> use Gaia AI proxy
        BASE_URL="https://agent.avatargaia.top/api/llm/v1"
        MODEL_ID="qwen3.5-flash"
        ok "Token configured! (Model: Qwen3.5-Flash)"
        ;;
    *)
        # Custom API key, ask for details
        info "Detected custom API key. Need additional info:"
        read -r -p "  API Base URL (e.g. https://dashscope.aliyuncs.com/compatible-mode/v1): " BASE_URL < /dev/tty
        read -r -p "  Model name (e.g. qwen-max, moonshot-v1-128k): " MODEL_ID < /dev/tty
        if [ -z "$BASE_URL" ] || [ -z "$MODEL_ID" ]; then
            err "Incomplete API info. Please re-run the script."
            exit 1
        fi
        ok "Custom API configured!"
        ;;
esac

info "Writing configuration..."

# Generate a random token
GATEWAY_TOKEN=$(openssl rand -hex 24 2>/dev/null || head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')

# Create config directory
OPENCLAW_DIR="$HOME/.openclaw"
WORKSPACE_DIR="$OPENCLAW_DIR/workspace"
mkdir -p "$WORKSPACE_DIR"

# Write config file (clean, well-structured JSON)
CONFIG_PATH="$OPENCLAW_DIR/openclaw.json"
cat > "$CONFIG_PATH" << JSONEOF
{
  "agents": {
    "defaults": {
      "workspace": "$WORKSPACE_DIR",
      "model": {
        "primary": "teamagent-ai/$MODEL_ID"
      },
      "compaction": {
        "mode": "safeguard"
      },
      "thinkingDefault": "low",
      "timeoutSeconds": 600,
      "heartbeat": {
        "every": "30m",
        "target": "last"
      }
    }
  },

  "models": {
    "providers": {
      "teamagent-ai": {
        "baseUrl": "$BASE_URL",
        "apiKey": "$API_KEY",
        "api": "openai-completions",
        "models": [
          { "id": "$MODEL_ID", "name": "$MODEL_ID" }
        ]
      }
    }
  },

  "gateway": {
    "mode": "local",
    "port": 18789,
    "bind": "loopback",
    "auth": {
      "mode": "token",
      "token": "$GATEWAY_TOKEN"
    },
    "tools": {
      "allow": ["sessions_send"]
    }
  },

  "commands": {
    "native": "auto",
    "nativeSkills": "auto",
    "restart": true
  },

  "skills": {
    "entries": {
      "teamagent": {
        "enabled": true
      }
    }
  }
}
JSONEOF

ok "Configuration written to $CONFIG_PATH"
info "Gateway Token: $GATEWAY_TOKEN"

# ============================================================
# Step 3.5: Install TeamAgent Skill
# ============================================================
info "Installing TeamAgent skill..."

SKILL_DIR="$WORKSPACE_DIR/skills"
SKILL_ZIP="/tmp/teamagent-client-skill.zip"

mkdir -p "$SKILL_DIR"

if curl -fsSL "https://agent.avatargaia.top/static/teamagent-client-skill.zip" -o "$SKILL_ZIP" 2>/dev/null; then
    if unzip -o "$SKILL_ZIP" -d "$SKILL_DIR" >/dev/null 2>&1; then
        ok "TeamAgent skill installed!"

        # Copy BOOTSTRAP.md and HEARTBEAT.md to workspace root
        BOOTSTRAP_SRC="$SKILL_DIR/teamagent-client-skill/BOOTSTRAP.md"
        HEARTBEAT_SRC="$SKILL_DIR/teamagent-client-skill/HEARTBEAT.md"
        if [ -f "$BOOTSTRAP_SRC" ]; then
            cp "$BOOTSTRAP_SRC" "$WORKSPACE_DIR/BOOTSTRAP.md"
            ok "First-run onboarding configured!"
        fi
        if [ -f "$HEARTBEAT_SRC" ]; then
            cp "$HEARTBEAT_SRC" "$WORKSPACE_DIR/HEARTBEAT.md"
            ok "Heartbeat configured!"
        fi
    else
        info "TeamAgent skill extraction failed, you can install it later."
    fi
else
    info "TeamAgent skill download failed, you can install it later."
fi

# ============================================================
# Step 3.6: Configure TeamAgent Client Token
# ============================================================
SKILL_BUNDLE_DIR="$SKILL_DIR/teamagent-client-skill"
if [ -f "$SKILL_BUNDLE_DIR/teamagent-client.js" ]; then
    case "$API_KEY" in
        ta_*)
            info "Configuring TeamAgent client with your token..."
            node "$SKILL_BUNDLE_DIR/teamagent-client.js" set-token "$API_KEY" 2>/dev/null && \
                ok "TeamAgent client configured!" || \
                info "TeamAgent client config skipped (will configure during bootstrap)"
            ;;
    esac
fi

confirm "Configuration done. Start OpenClaw?"

# ============================================================
# Step 4: Start OpenClaw Gateway
# ============================================================
step 4 "Start OpenClaw Gateway"

info "Starting Gateway..."

# Run doctor --fix first
openclaw doctor --fix 2>&1 | while IFS= read -r line; do echo -e "  ${GRAY}$line${NC}"; done || true

# Re-apply HEARTBEAT.md after doctor --fix (doctor may reset it to empty default)
HEARTBEAT_SRC="$WORKSPACE_DIR/skills/teamagent-client-skill/HEARTBEAT.md"
if [ -f "$HEARTBEAT_SRC" ]; then
    cp "$HEARTBEAT_SRC" "$WORKSPACE_DIR/HEARTBEAT.md"
    ok "Gaia heartbeat re-applied (post-doctor)"
fi

# Start gateway in background
nohup openclaw gateway > /tmp/openclaw-gateway.log 2>&1 &
GATEWAY_PID=$!
disown $GATEWAY_PID 2>/dev/null

# Wait for Gateway to be ready
info "Waiting for Gateway to start..."
sleep 3
RETRIES=0
GATEWAY_OK=false
while [ $RETRIES -lt 10 ]; do
    if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:18789/" 2>/dev/null | grep -q "200"; then
        GATEWAY_OK=true
        break
    fi
    RETRIES=$((RETRIES + 1))
    printf "  ."
    sleep 2
done
echo ""

if [ "$GATEWAY_OK" = true ]; then
    ok "Gateway is running! (PID: $GATEWAY_PID)"
else
    info "Gateway may need manual start. Try: openclaw gateway"
    info "Check logs: /tmp/openclaw-gateway.log"
fi

# ============================================================
# Step 4.5: Start TeamAgent Watch Daemon
# ============================================================
WATCH_STARTED=false
if [ -f "$SKILL_BUNDLE_DIR/agent-worker.js" ]; then
    # Only start watch if token was configured (ta_ token set)
    TA_CONFIG="$HOME/.teamagent/config.json"
    if [ -f "$TA_CONFIG" ]; then
        info "Starting TeamAgent Watch daemon (autonomous task execution)..."

        # Create a restart-safe wrapper script
        WATCH_SCRIPT="$HOME/.teamagent/start-watch.sh"
        mkdir -p "$HOME/.teamagent"
        cat > "$WATCH_SCRIPT" << 'WATCHEOF'
#!/bin/bash
# TeamAgent Watch Daemon — auto-restart on crash
SKILL_DIR="$HOME/.openclaw/workspace/skills/teamagent-client-skill"
LOG_FILE="/tmp/teamagent-watch.log"
MAX_RESTARTS=10
RESTART_COUNT=0

while [ $RESTART_COUNT -lt $MAX_RESTARTS ]; do
    echo "[$(date)] Starting watch daemon (attempt $((RESTART_COUNT+1))/$MAX_RESTARTS)" >> "$LOG_FILE"
    node "$SKILL_DIR/agent-worker.js" watch >> "$LOG_FILE" 2>&1
    EXIT_CODE=$?
    RESTART_COUNT=$((RESTART_COUNT+1))
    if [ $EXIT_CODE -eq 0 ]; then
        echo "[$(date)] Watch daemon exited cleanly." >> "$LOG_FILE"
        break
    fi
    echo "[$(date)] Watch daemon crashed (exit=$EXIT_CODE), restarting in 5s..." >> "$LOG_FILE"
    sleep 5
done
WATCHEOF
        chmod +x "$WATCH_SCRIPT"

        # Start the watch daemon in background
        nohup bash "$WATCH_SCRIPT" > /dev/null 2>&1 &
        WATCH_PID=$!
        disown $WATCH_PID 2>/dev/null
        sleep 2

        # Verify it's running
        if kill -0 $WATCH_PID 2>/dev/null; then
            ok "Watch daemon started! (PID: $WATCH_PID)"
            ok "Agent will auto-execute tasks assigned to it"
            WATCH_STARTED=true
        else
            info "Watch daemon couldn't start yet (agent may need registration first)"
            info "It will auto-start after you complete the bootstrap conversation"
        fi
    else
        info "TeamAgent token not configured yet — Watch will start after bootstrap"
    fi
fi

confirm "All set! Open chat window?"

# ============================================================
# Step 5: Open Chat
# ============================================================
step 5 "Open Chat Window"

CHAT_URL="http://127.0.0.1:18789/?token=$GATEWAY_TOKEN"
ok "Opening browser..."

# Open browser (macOS / Linux)
if [[ "$OSTYPE" == "darwin"* ]]; then
    open "$CHAT_URL"
elif command -v xdg-open &>/dev/null; then
    xdg-open "$CHAT_URL"
else
    info "Please open this URL in your browser:"
    echo -e "  $CHAT_URL"
fi

echo ""
echo -e "  ${GREEN}======================================${NC}"
echo -e "  ${GREEN}     Installation Complete!           ${NC}"
echo -e "  ${GREEN}  Start chatting with your AI now!    ${NC}"
echo -e "  ${GREEN}======================================${NC}"
echo ""
echo -e "  ${YELLOW}Chat URL:${NC}"
echo -e "  ${WHITE}$CHAT_URL${NC}"
echo ""

# Copy to clipboard
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo -n "$CHAT_URL" | pbcopy 2>/dev/null && ok "URL copied to clipboard!"
elif command -v xclip &>/dev/null; then
    echo -n "$CHAT_URL" | xclip -selection clipboard 2>/dev/null && ok "URL copied to clipboard!"
fi

echo ""
echo -e "  ${WHITE}Useful commands:${NC}"
echo -e "  ${GRAY}  openclaw dashboard      - Open chat${NC}"
echo -e "  ${GRAY}  openclaw gateway status  - Check status${NC}"
echo -e "  ${GRAY}  openclaw configure       - Edit config${NC}"
echo ""
if [ "$WATCH_STARTED" = true ]; then
echo -e "  ${GREEN}🤖 Agent Watch daemon is running!${NC}"
echo -e "  ${GRAY}  Your Agent will auto-execute tasks from TeamAgent Hub.${NC}"
echo -e "  ${GRAY}  Logs: /tmp/teamagent-watch.log${NC}"
echo -e "  ${GRAY}  Restart: bash ~/.teamagent/start-watch.sh${NC}"
else
echo -e "  ${YELLOW}📋 Next: Complete the bootstrap chat to activate your Agent.${NC}"
echo -e "  ${GRAY}  Your Agent will auto-start watching tasks after registration.${NC}"
fi
echo ""
echo -e "  ${MAGENTA}Powered by Gaia x OpenClaw${NC}"
echo ""
