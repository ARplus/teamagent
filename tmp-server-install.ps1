# ============================================================
#  OpenClaw One-Click Installer (Windows PowerShell)
#  Powered by Gaia Team
# ============================================================

# ---- FIRST LINE: Prevent silent close no matter what ----
$ErrorActionPreference = "Continue"
Read-Host "OpenClaw Installer loaded. Press Enter to start"

# ---- Global error trap: NEVER let the window close silently ----
trap {
    Write-Host ""
    Write-Host "  [ERROR] Something went wrong:" -ForegroundColor Red
    Write-Host "  $_" -ForegroundColor Red
    Write-Host ""
    Read-Host "  Press Enter to close"
    break
}

# ---- Helpers ----
function Write-Step($num, $text) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Step $num - $text" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
}

function Write-Ok($text) {
    Write-Host "  [OK] $text" -ForegroundColor Green
}

function Write-Info($text) {
    Write-Host "  [..] $text" -ForegroundColor Yellow
}

function Write-Err($text) {
    Write-Host "  [!!] $text" -ForegroundColor Red
}

function Confirm-Continue($prompt) {
    Write-Host ""
    Write-Host "  $prompt" -ForegroundColor White
    $key = Read-Host "  Press Enter to continue, or 'q' to quit"
    if ($key -eq 'q') {
        Write-Host "  Exited." -ForegroundColor Yellow
        exit 0
    }
}

# ---- Welcome ----
Clear-Host
Write-Host ""
Write-Host "  OpenClaw One-Click Installer" -ForegroundColor Magenta
Write-Host "  =============================" -ForegroundColor Magenta
Write-Host ""
Write-Host "  This script will:" -ForegroundColor White
Write-Host "    1. Check / Install Node.js" -ForegroundColor Gray
Write-Host "    2. Install OpenClaw CLI" -ForegroundColor Gray
Write-Host "    3. Configure AI Token" -ForegroundColor Gray
Write-Host "    4. Start OpenClaw Gateway" -ForegroundColor Gray
Write-Host "    5. Open Chat Window" -ForegroundColor Gray
Write-Host ""
Write-Host "  Just press Enter at each step." -ForegroundColor DarkGray
Write-Host ""

Confirm-Continue "Ready?"

# ============================================================
# Step 1: Check / Install Node.js
# ============================================================
Write-Step 1 "Check Node.js"

$nodeOk = $false
try {
    $nodeVer = (node --version 2>$null)
    if ($nodeVer) {
        $major = [int]($nodeVer -replace 'v(\d+)\..*', '$1')
        if ($major -ge 22) {
            Write-Ok "Node.js $nodeVer installed (>= 22)"
            $nodeOk = $true
        } else {
            Write-Info "Node.js $nodeVer is too old, need >= 22"
        }
    }
} catch {}

if (-not $nodeOk) {
    Write-Info "Need to install Node.js 22+..."
    Confirm-Continue "Will download and install Node.js LTS from nodejs.org. OK?"

    $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    $nodeUrl = "https://nodejs.org/dist/v22.16.0/node-v22.16.0-$arch.msi"
    $msiPath = Join-Path $env:TEMP "node-install.msi"

    Write-Info "Downloading: $nodeUrl"
    try {
        Invoke-WebRequest -Uri $nodeUrl -OutFile $msiPath -UseBasicParsing
    } catch {
        Write-Info "Official download failed, trying npmmirror..."
        $nodeUrl = "https://npmmirror.com/mirrors/node/v22.16.0/node-v22.16.0-$arch.msi"
        Invoke-WebRequest -Uri $nodeUrl -OutFile $msiPath -UseBasicParsing
    }

    Write-Info "Installing Node.js (a setup window may appear)..."
    Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /passive /norestart" -Wait

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    $nodeVer = (node --version 2>$null)
    if ($nodeVer) {
        Write-Ok "Node.js $nodeVer installed successfully!"
    } else {
        Write-Err "Node.js installation failed. Please install manually from https://nodejs.org/"
        exit 1
    }
}

Confirm-Continue "Node.js ready. Install OpenClaw?"

# ============================================================
# Step 1.5: Check / Install Git
# ============================================================
$gitExists = (Get-Command git -ErrorAction SilentlyContinue)
if (-not $gitExists) {
    Write-Info "Git not found. Installing Git for Windows..."
    $gitInstalled = $false

    # Method 1: Try winget (built into Windows 10/11)
    $wingetExists = (Get-Command winget -ErrorAction SilentlyContinue)
    if ($wingetExists) {
        Write-Info "Installing Git via winget..."
        try {
            winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
            if (Get-Command git -ErrorAction SilentlyContinue) { $gitInstalled = $true }
        } catch {
            Write-Info "winget install failed, trying other methods..."
        }
    }

    # Method 2: Download exe from GitHub
    if (-not $gitInstalled) {
        $arch = if ([Environment]::Is64BitOperatingSystem) { "64" } else { "32" }
        $gitInstaller = Join-Path $env:TEMP "git-install.exe"

        try {
            Write-Info "Fetching latest Git version from GitHub..."
            $release = Invoke-RestMethod -Uri "https://api.github.com/repos/git-for-windows/git/releases/latest" -UseBasicParsing
            $asset = $release.assets | Where-Object { $_.name -match "Git-.*-$arch-bit\.exe$" -and $_.name -notmatch "portable" } | Select-Object -First 1
            if ($asset) {
                Write-Info "Downloading Git $($release.tag_name) (may take a few minutes)..."
                Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $gitInstaller -UseBasicParsing
                Write-Info "Installing Git (silent)..."
                Start-Process -FilePath $gitInstaller -ArgumentList "/VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS" -Wait
                $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
                if (Get-Command git -ErrorAction SilentlyContinue) { $gitInstalled = $true }
            }
        } catch {
            Write-Info "GitHub download failed."
        }
    }

    if ($gitInstalled) {
        Write-Ok "Git installed!"
    } else {
        Write-Info "Git installation failed. Will continue without Git."
        Write-Info "You can install Git later from https://git-scm.com/"
        Write-Info "(OpenClaw works without Git, but some features may be limited)"
    }
}

# ============================================================
# Step 2: Install OpenClaw CLI
# ============================================================
Write-Step 2 "Install OpenClaw CLI"

$clawInstalled = $false
$targetVer = "2026.3.8"
try {
    $clawVer = (openclaw --version 2>$null)
    if ($clawVer -match $targetVer) {
        Write-Ok "OpenClaw $clawVer already installed"
        $clawInstalled = $true
    } elseif ($clawVer) {
        Write-Host "  [UPGRADE] OpenClaw $clawVer -> $targetVer" -ForegroundColor Yellow
    }
} catch {}

if (-not $clawInstalled) {
    Write-Info "Installing OpenClaw via npm..."
    Write-Info "(This may take a few minutes, please wait...)"

    # Run npm install, ignore warnings (they go to stderr)
    $ErrorActionPreference = "Continue"
    # Fix: GitHub SSH access fails without SSH key, use HTTPS instead
    git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" 2>$null
    git config --global url."https://github.com/".insteadOf "git@github.com:" 2>$null

    # Use China npm mirror (default registry blocked in China)
    npm config set registry https://registry.npmmirror.com 2>$null

    npm install -g openclaw@2026.3.8 2>&1 | ForEach-Object {
        $line = $_.ToString()
        if ($line -notmatch "^npm warn") {
            Write-Host "  $line" -ForegroundColor DarkGray
        }
    }
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    $clawVer = (openclaw --version 2>$null)
    if ($clawVer) {
        Write-Ok "OpenClaw $clawVer installed successfully!"
    } else {
        Write-Err "OpenClaw installation failed. Check your network and retry."
        exit 1
    }
}

Confirm-Continue "OpenClaw ready. Configure AI model?"

# ============================================================
# Step 3: Configure AI Token
# ============================================================
Write-Step 3 "Configure AI Token"

Write-Host ""
Write-Host "  Choose AI model:" -ForegroundColor White
Write-Host "    [1] Use TeamAgent AI (recommended - enter your Token)" -ForegroundColor Green
Write-Host "    [2] Use your own API Key (advanced)" -ForegroundColor Gray
Write-Host ""

$modelChoice = Read-Host "  Enter choice (1/2), press Enter for default [1]"
if ([string]::IsNullOrWhiteSpace($modelChoice)) { $modelChoice = "1" }

if ($modelChoice -eq "1") {
    Write-Host ""
    Write-Host "  Please enter your TeamAgent Token (ta_xxx...)." -ForegroundColor White
    Write-Host "  Token can be found at: https://agent.avatargaia.top -> Settings" -ForegroundColor Gray
    Write-Host "  (Register first if you don't have one)" -ForegroundColor Gray
    Write-Host ""
    $apiKey = Read-Host "  Token (ta_xxx)"

    if ([string]::IsNullOrWhiteSpace($apiKey)) {
        Write-Err "Token is required. Please register at https://agent.avatargaia.top first."
        exit 1
    }
    if (-not $apiKey.StartsWith("ta_")) {
        Write-Info "Warning: Token usually starts with 'ta_'. Continuing anyway..."
    }

    $baseUrl = "https://agent.avatargaia.top/api/llm/v1"
    $modelId = "qwen-turbo"
    Write-Ok "Selected: TeamAgent AI (Qwen-Turbo via Gaia Proxy)"
    Write-Info "Your API key never leaves the server. Safe and secure!"
} else {
    Write-Host ""
    Write-Host "  Supports OpenAI-compatible APIs (Qwen, Kimi, DeepSeek, etc.)" -ForegroundColor Gray
    Write-Host ""
    $baseUrl = Read-Host "  API Base URL (e.g. https://dashscope.aliyuncs.com/compatible-mode/v1)"
    $apiKey = Read-Host "  API Key"
    $modelId = Read-Host "  Model name (e.g. qwen-max, moonshot-v1-128k)"

    if ([string]::IsNullOrWhiteSpace($baseUrl) -or [string]::IsNullOrWhiteSpace($apiKey) -or [string]::IsNullOrWhiteSpace($modelId)) {
        Write-Err "Incomplete API info. Please re-run the script."
        exit 1
    }
}

Write-Info "Writing configuration..."

# Generate a random token
$tokenBytes = New-Object byte[] 24
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($tokenBytes)
$gatewayToken = ($tokenBytes | ForEach-Object { $_.ToString("x2") }) -join ""

# Create config directory
$openclawDir = Join-Path $env:USERPROFILE ".openclaw"
$workspaceDir = Join-Path $openclawDir "workspace"
New-Item -ItemType Directory -Path $openclawDir -Force | Out-Null
New-Item -ItemType Directory -Path $workspaceDir -Force | Out-Null

# Write config file directly (clean JSON, guaranteed field order)
$configPath = Join-Path $openclawDir "openclaw.json"
$escapedWorkspace = $workspaceDir -replace '\\', '\\\\'
$configJson = @"
{
  "agents": {
    "defaults": {
      "workspace": "$escapedWorkspace",
      "model": {
        "primary": "qwen-dashscope/$modelId"
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
      "qwen-dashscope": {
        "baseUrl": "$baseUrl",
        "apiKey": "$apiKey",
        "api": "openai-completions",
        "models": [
          { "id": "$modelId", "name": "$modelId" }
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
      "token": "$gatewayToken"
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
"@
# Write as UTF-8 without BOM (PS5 Set-Content -Encoding UTF8 adds BOM which breaks JSON parsers)
[System.IO.File]::WriteAllText($configPath, $configJson, (New-Object System.Text.UTF8Encoding $false))

Write-Ok "Configuration written to $configPath"
Write-Info "Gateway Token: $gatewayToken"

# ============================================================
# Step 3.5: Install TeamAgent Skill
# ============================================================
Write-Info "Installing TeamAgent skill..."

$skillDir = Join-Path $workspaceDir "skills"
$skillZip = Join-Path $env:TEMP "teamagent-client-skill.zip"

New-Item -ItemType Directory -Path $skillDir -Force | Out-Null

try {
    Invoke-WebRequest -Uri "https://agent.avatargaia.top/static/teamagent-client-skill.zip" -OutFile $skillZip -UseBasicParsing
    Expand-Archive -Path $skillZip -DestinationPath $skillDir -Force
    Write-Ok "TeamAgent skill installed!"

    # Copy BOOTSTRAP.md to workspace root (triggers first-run onboarding)
    $bootstrapSrc = Join-Path $skillDir "teamagent-client-skill\BOOTSTRAP.md"
    $bootstrapDst = Join-Path $workspaceDir "BOOTSTRAP.md"
    if (Test-Path $bootstrapSrc) {
        Copy-Item $bootstrapSrc $bootstrapDst -Force
        Write-Ok "First-run onboarding configured!"
    }
} catch {
    Write-Info "TeamAgent skill download failed, you can install it later."
}

Confirm-Continue "Configuration done. Start OpenClaw?"

# ============================================================
# Step 4: Start OpenClaw Gateway
# ============================================================
Write-Step 4 "Start OpenClaw Gateway"

Write-Info "Starting Gateway..."

# Run doctor --fix first to clean any invalid keys
$ErrorActionPreference = "Continue"
openclaw doctor --fix 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }

# Start gateway in a new cmd window (avoids .ps1 file-association popup)
# Use "openclaw gateway" (foreground mode in new window) instead of "gateway start" (service mode)
# so the user can see gateway logs and it works without schtasks registration
$openclawCmd = (Get-Command openclaw -ErrorAction SilentlyContinue).Source
if (-not $openclawCmd) {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    $openclawCmd = (Get-Command openclaw -ErrorAction SilentlyContinue).Source
}
if ($openclawCmd -and $openclawCmd.EndsWith(".ps1")) {
    $cmdVersion = $openclawCmd -replace '\.ps1$', '.cmd'
    if (Test-Path $cmdVersion) { $openclawCmd = $cmdVersion }
}
if ($openclawCmd) {
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$openclawCmd`" gateway" -WindowStyle Minimized -ErrorAction SilentlyContinue
} else {
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c openclaw gateway" -WindowStyle Minimized -ErrorAction SilentlyContinue
}

# Wait for Gateway to be ready
Write-Info "Waiting for Gateway to start..."
Start-Sleep -Seconds 3
$retries = 0
$gatewayOk = $false
while ($retries -lt 10) {
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:18789/" -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($resp.StatusCode -eq 200) {
            $gatewayOk = $true
            break
        }
    } catch {}
    $retries++
    Write-Host "  ." -NoNewline -ForegroundColor DarkGray
    Start-Sleep -Seconds 2
}
Write-Host ""

if ($gatewayOk) {
    Write-Ok "Gateway is running!"
} else {
    Write-Info "Gateway may need manual start. Try: openclaw gateway"
}

Confirm-Continue "All set! Open chat window?"

# ============================================================
# Step 5: Open Chat
# ============================================================
Write-Step 5 "Open Chat Window"

# Open browser with token in URL for auto-auth
$chatUrl = "http://127.0.0.1:18789/?token=$gatewayToken"
Write-Ok "Opening browser..."
Start-Process $chatUrl

Write-Host ""
Write-Host "  ======================================" -ForegroundColor Green
Write-Host "       Installation Complete!           " -ForegroundColor Green
Write-Host "    Start chatting with your AI now!    " -ForegroundColor Green
Write-Host "  ======================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Chat URL:" -ForegroundColor Yellow
Write-Host "  $chatUrl" -ForegroundColor White
Write-Host ""
try {
    Set-Clipboard -Value $chatUrl
    Write-Ok "URL copied to clipboard!"
} catch {}
Write-Host ""
Write-Host "  Useful commands:" -ForegroundColor White
Write-Host "    openclaw dashboard      - Open chat" -ForegroundColor Gray
Write-Host "    openclaw gateway status - Check status" -ForegroundColor Gray
Write-Host "    openclaw configure      - Edit config" -ForegroundColor Gray
Write-Host ""
Write-Host "  Powered by Gaia x OpenClaw" -ForegroundColor Magenta
Write-Host ""
Read-Host "  Press Enter to close this window"
