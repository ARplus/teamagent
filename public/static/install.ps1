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

function Exit-Fail($msg) {
    Write-Host ""
    Write-Host "  [FAILED] $msg" -ForegroundColor Red
    Write-Host ""
    Read-Host "  Press Enter to close"
    exit 1
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
        if ($major -ge 18) {
            Write-Ok "Node.js $nodeVer installed (>= 18)"
            $nodeOk = $true
        } else {
            Write-Info "Node.js $nodeVer is too old, need >= 18"
        }
    }
} catch {}

if (-not $nodeOk) {
    Write-Info "Need to install Node.js 22+..."

    $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    $nodeVersion = "v22.14.0"
    $ProgressPreference = 'SilentlyContinue'

    # Detect admin privileges
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

    $nodeExe = $null

    try {
        if ($isAdmin) {
            # Admin: use MSI (system-wide install)
            Confirm-Continue "Will download and install Node.js $nodeVersion (MSI). OK?"
            $msiPath = Join-Path $env:TEMP "node-install.msi"

            $nodeUrl = "https://cdn.npmmirror.com/binaries/node/$nodeVersion/node-$nodeVersion-$arch.msi"
            Write-Info "Downloading: $nodeUrl"
            $dlOk = $false
            try {
                Invoke-WebRequest -Uri $nodeUrl -OutFile $msiPath -UseBasicParsing -TimeoutSec 120
                $dlOk = $true
            } catch {
                Write-Info "Mirror failed, trying nodejs.org..."
            }
            if (-not $dlOk) {
                try {
                    $nodeUrl = "https://nodejs.org/dist/$nodeVersion/node-$nodeVersion-$arch.msi"
                    Invoke-WebRequest -Uri $nodeUrl -OutFile $msiPath -UseBasicParsing -TimeoutSec 120
                    $dlOk = $true
                } catch {
                    Exit-Fail "Node.js download failed from all sources. Check your network."
                }
            }

            Write-Info "Installing Node.js $nodeVersion (this may take a minute)..."
            $msi = Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /passive /norestart" -Wait -PassThru
            if ($msi.ExitCode -ne 0) {
                Exit-Fail "MSI installer failed (code $($msi.ExitCode)). Try running PowerShell as Administrator."
            }
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
            $_nodeCmd = Get-Command node -ErrorAction SilentlyContinue
            $nodeExe = if ($_nodeCmd) { $_nodeCmd.Source } else { $null }

        } else {
            # Non-admin: use ZIP to ~/nodejs
            Confirm-Continue "Will download Node.js $nodeVersion (no admin needed, ZIP mode). OK?"
            $nodeDir = Join-Path $env:USERPROFILE "nodejs"
            $zipName = "node-$nodeVersion-win-$arch.zip"
            $zipPath = Join-Path $env:TEMP $zipName

            $nodeUrl = "https://cdn.npmmirror.com/binaries/node/$nodeVersion/$zipName"
            Write-Info "Downloading: $nodeUrl"
            $dlOk = $false
            try {
                Invoke-WebRequest -Uri $nodeUrl -OutFile $zipPath -UseBasicParsing -TimeoutSec 180
                $dlOk = $true
            } catch {
                Write-Info "Mirror failed, trying nodejs.org..."
            }
            if (-not $dlOk) {
                try {
                    $nodeUrl = "https://nodejs.org/dist/$nodeVersion/$zipName"
                    Invoke-WebRequest -Uri $nodeUrl -OutFile $zipPath -UseBasicParsing -TimeoutSec 180
                    $dlOk = $true
                } catch {
                    Exit-Fail "Node.js download failed from all sources. Check your network."
                }
            }

            Write-Info "Extracting Node.js to $nodeDir ..."
            if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
            Expand-Archive -Path $zipPath -DestinationPath $env:USERPROFILE -Force
            $extractedDir = Join-Path $env:USERPROFILE "node-$nodeVersion-win-$arch"
            if (Test-Path $extractedDir) { Rename-Item $extractedDir $nodeDir -ErrorAction SilentlyContinue }

            if (-not (Test-Path "$nodeDir\node.exe")) {
                Exit-Fail "Node.js extraction failed. Please install manually: https://nodejs.org/"
            }

            $currentUserPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
            $cleanedUserPath = ($currentUserPath -split ';' | Where-Object { $_ -notlike "*\nodejs*" -and $_ -ne "" }) -join ';'
            [System.Environment]::SetEnvironmentVariable("Path", "$nodeDir;$cleanedUserPath", "User")
            Write-Ok "Node.js added to user PATH"

            $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
            $env:Path = "$nodeDir;$machinePath;$cleanedUserPath"
            $nodeExe = "$nodeDir\node.exe"
        }
    } catch {
        Exit-Fail "Node.js installation failed: $_"
    }

    $ProgressPreference = 'Continue'

    $nodeVer = if ($nodeExe -and (Test-Path $nodeExe)) {
        & $nodeExe --version 2>$null
    } else {
        node --version 2>$null
    }
    if ($nodeVer) {
        Write-Ok "Node.js $nodeVer installed successfully!"
    } else {
        Exit-Fail "Node.js installation failed. Please install manually: https://nodejs.org/"
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

    # Method 2: Download Git via China-accessible mirror (ghproxy → GitHub releases)
    if (-not $gitInstalled) {
        $arch = if ([Environment]::Is64BitOperatingSystem) { "64" } else { "32" }
        $gitInstaller = Join-Path $env:TEMP "git-install.exe"

        # Hardcoded stable version via ghproxy (avoids api.github.com which is blocked in China)
        $gitVersion = "2.47.1"
        $gitFile = "Git-$gitVersion-$arch-bit.exe"
        $gitUrls = @(
            "https://ghproxy.com/https://github.com/git-for-windows/git/releases/download/v$gitVersion.windows.1/$gitFile",
            "https://hub.gitmirror.com/https://github.com/git-for-windows/git/releases/download/v$gitVersion.windows.1/$gitFile",
            "https://github.com/git-for-windows/git/releases/download/v$gitVersion.windows.1/$gitFile"
        )
        $gitDownloaded = $false
        foreach ($gitUrl in $gitUrls) {
            try {
                Write-Info "Downloading Git $gitVersion from: $gitUrl"
                Invoke-WebRequest -Uri $gitUrl -OutFile $gitInstaller -UseBasicParsing -TimeoutSec 120
                if ((Test-Path $gitInstaller) -and (Get-Item $gitInstaller).Length -gt 1000000) {
                    $gitDownloaded = $true
                    break
                }
            } catch {
                Write-Info "  Mirror failed, trying next..."
            }
        }
        if ($gitDownloaded) {
            try {
                Write-Info "Installing Git (silent)..."
                Start-Process -FilePath $gitInstaller -ArgumentList "/VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS" -Wait
                $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
                if (Get-Command git -ErrorAction SilentlyContinue) { $gitInstalled = $true }
            } catch {
                Write-Info "Git install failed."
            }
        } else {
            Write-Info "Git download failed from all mirrors."
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
try {
    $clawVer = (openclaw --version 2>$null)
    if ($clawVer) {
        Write-Ok "OpenClaw $clawVer already installed (latest)"
        $clawInstalled = $true
    }
} catch {}

if (-not $clawInstalled) {
    Write-Info "Installing OpenClaw via npm..."
    Write-Info "(This may take a few minutes, please wait...)"

    # Run npm install, ignore warnings (they go to stderr)
    $ErrorActionPreference = "Continue"
    Write-Info "npm mirror: npmmirror.com enabled"

    # Use npm.cmd explicitly to bypass PowerShell ExecutionPolicy blocking npm.ps1
    $npmCmd = "npm.cmd"
    if (-not (Get-Command $npmCmd -ErrorAction SilentlyContinue)) { $npmCmd = "npm" }

    # Temporarily use China npm mirror for install
    $npmRegistryOriginal = & cmd /c "$npmCmd config get registry" 2>$null
    & cmd /c "$npmCmd config set registry https://registry.npmmirror.com" 2>$null

    # Redirect SSH git -> HTTPS so libsignal-node and other git deps don't need SSH keys
    $gitSshRedirectSet = $false
    if (Get-Command git -ErrorAction SilentlyContinue) {
        git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" 2>$null
        $gitSshRedirectSet = $true
    }

    # Skip node-llama-cpp build AND prebuilt binary download (both hit GitHub, blocked in China)
    $env:NODE_LLAMA_CPP_SKIP_BUILD = "1"
    $env:LLAMA_CPP_NO_PRE_FETCH = "1"
    $env:NODE_LLAMA_CPP_SKIP_DOWNLOAD = "1"
    & cmd /c "$npmCmd install -g openclaw@2026.3.13" 2>&1 | ForEach-Object {
        $line = $_.ToString()
        if ($line -notmatch "^npm warn") {
            Write-Host "  $line" -ForegroundColor DarkGray
        }
    }
    Remove-Item Env:\NODE_LLAMA_CPP_SKIP_BUILD -ErrorAction SilentlyContinue
    Remove-Item Env:\LLAMA_CPP_NO_PRE_FETCH -ErrorAction SilentlyContinue
    Remove-Item Env:\NODE_LLAMA_CPP_SKIP_DOWNLOAD -ErrorAction SilentlyContinue

    # Restore git SSH redirect
    if ($gitSshRedirectSet) {
        git config --global --unset url."https://github.com/".insteadOf 2>$null
    }

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")


    # Restore npm registry to original (don't permanently pollute user config)
    if ($npmRegistryOriginal -and $npmRegistryOriginal -ne "https://registry.npmmirror.com") {
        & cmd /c "$npmCmd config set registry $npmRegistryOriginal" 2>$null
        Write-Info "npm registry restored to: $npmRegistryOriginal"
    }

    # Check: openclaw --version, or fallback to binary file existence
    $clawVer = $null
    try { $clawVer = (openclaw --version 2>$null) } catch {}
    if (-not $clawVer) {
        # Some systems need a second PATH refresh before openclaw is found
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        try { $clawVer = (openclaw --version 2>$null) } catch {}
    }
    if (-not $clawVer) {
        # Fallback: check binary file exists in npm global bin
        $npmGlobalBin = (& cmd /c "$npmCmd prefix -g" 2>$null)
        if ($npmGlobalBin) {
            $npmGlobalBin = "$npmGlobalBin".Trim()
        }
        if ($npmGlobalBin -and $npmGlobalBin.Length -gt 0) {
            $clawCmdPath = Join-Path $npmGlobalBin "openclaw.cmd"
            if (Test-Path $clawCmdPath) { $clawVer = "installed" }
        }
    }
    if ($clawVer) {
        Write-Ok "OpenClaw $clawVer installed successfully!"
    } else {
        Exit-Fail "OpenClaw installation failed. Check your network and retry."
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
        Exit-Fail "Token is required. Please register at https://agent.avatargaia.top first."
    }
    if (-not $apiKey.StartsWith("ta_")) {
        Write-Info "Warning: Token usually starts with 'ta_'. Continuing anyway..."
    }

    $baseUrl = "https://agent.avatargaia.top/api/llm/v1"
    $modelId = "kimi-k2.5"
    Write-Ok "Selected: Kimi K2.5 (via TeamAgent)"
} else {
    Write-Host ""
    Write-Host "  Supports OpenAI-compatible APIs (Qwen, Kimi, DeepSeek, etc.)" -ForegroundColor Gray
    Write-Host ""
    $baseUrl = Read-Host "  API Base URL (e.g. https://dashscope.aliyuncs.com/compatible-mode/v1)"
    $apiKey = Read-Host "  API Key"
    $modelId = Read-Host "  Model name (e.g. qwen-max, moonshot-v1-128k)"

    if ([string]::IsNullOrWhiteSpace($baseUrl) -or [string]::IsNullOrWhiteSpace($apiKey) -or [string]::IsNullOrWhiteSpace($modelId)) {
        Exit-Fail "Incomplete API info. Please re-run the script."
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
        "primary": "kimi/$modelId"
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
      "kimi": {
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
if (-not (Test-Path $skillDir)) { New-Item -ItemType Directory -Path $skillDir -Force | Out-Null }
$downloadUrl = "https://agent.avatargaia.top/static/teamagent-client-skill.zip"
Write-Info "Downloading skill bundle..."
$certResult = & cmd /c "certutil -urlcache -split -f `"$downloadUrl`" `"$skillZip`"" 2>&1
$skillOk = $false
if ((Test-Path $skillZip) -and (Get-Item $skillZip).Length -gt 1000) {
    Write-Info "Extracting..."
    Expand-Archive -Path $skillZip -DestinationPath $skillDir -Force
    Write-Ok "TeamAgent skill installed!"
    $skillOk = $true

    # Copy BOOTSTRAP.md to workspace root (triggers first-run onboarding)
    $bootstrapSrc = Join-Path $skillDir "teamagent-client-skill\BOOTSTRAP.md"
    if (Test-Path $bootstrapSrc) {
        Copy-Item $bootstrapSrc (Join-Path $workspaceDir "BOOTSTRAP.md") -Force
        Write-Ok "First-run onboarding configured!"
    }

    # Copy HEARTBEAT.md to workspace root (enables self-check on every heartbeat)
    $heartbeatSrc = Join-Path $skillDir "teamagent-client-skill\HEARTBEAT.md"
    if (Test-Path $heartbeatSrc) {
        Copy-Item $heartbeatSrc (Join-Path $workspaceDir "HEARTBEAT.md") -Force
        Write-Ok "Heartbeat configured!"
    }

    # 🔒 Protect critical files from being overwritten by AI during bootstrap
    # The agent's LLM may try to "simplify" or rewrite skill files — we prevent that.
    $protectedFiles = @(
        "agent-worker.js",
        "decompose-handler.js",
        "teamagent-client.js",
        "gaia-decompose-SKILL.md",
        "gaia-template-exec-SKILL.md",
        "gaia-template-publish-SKILL.md",
        "PROTOCOL.md"
    )
    $bundleDir = Join-Path $skillDir "teamagent-client-skill"
    foreach ($f in $protectedFiles) {
        $fPath = Join-Path $bundleDir $f
        if (Test-Path $fPath) {
            Set-ItemProperty $fPath -Name IsReadOnly -Value $true
        }
    }
    Write-Ok "Core skill files protected (read-only)!"
}
if (-not $skillOk) {
    Write-Info "Skill download skipped. You can install it later via bootstrap."
}

# ============================================================
# Step 3.6: Configure TeamAgent Client Token
# ============================================================
$skillBundleDir = Join-Path $skillDir "teamagent-client-skill"
$clientJs = Join-Path $skillBundleDir "teamagent-client.js"
if ((Test-Path $clientJs) -and $apiKey.StartsWith("ta_")) {
    Write-Info "Configuring TeamAgent client with your token..."
    try {
        $setTokenOutput = & node $clientJs set-token $apiKey 2>&1
        $setTokenOutput | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
        Write-Ok "TeamAgent client configured!"
    } catch {
        Write-Info "TeamAgent client config skipped (will configure during bootstrap)"
    }
}

Confirm-Continue "Configuration done. Start OpenClaw?"

# ============================================================
# Step 4: Start OpenClaw Gateway
# ============================================================
Write-Step 4 "Start OpenClaw Gateway"

Write-Info "Starting Gateway..."

# Resolve openclaw path — always prefer .cmd over .ps1 to bypass ExecutionPolicy
function Get-OpenclawCmd {
    foreach ($ext in @('.cmd', '.exe', '.ps1', '')) {
        $p = (Get-Command "openclaw$ext" -ErrorAction SilentlyContinue)
        if ($p) { return $p.Source }
    }
    return $null
}
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
$openclawCmd = Get-OpenclawCmd

# Run doctor --fix first to clean any invalid keys
$ErrorActionPreference = "Continue"
if ($openclawCmd) {
    & cmd /c "`"$openclawCmd`" doctor --fix" 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
} else {
    & cmd /c "openclaw doctor --fix" 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
}

# Re-apply HEARTBEAT.md after doctor --fix (doctor may reset it to empty default)
$heartbeatSrc = Join-Path $workspaceDir "skills\teamagent-client-skill\HEARTBEAT.md"
if (Test-Path $heartbeatSrc) {
    Copy-Item $heartbeatSrc (Join-Path $workspaceDir "HEARTBEAT.md") -Force
    Write-OK "Gaia heartbeat re-applied (post-doctor)"
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

# ============================================================
# Step 4.5: Start TeamAgent Watch Daemon
# ============================================================
$watchStarted = $false
$workerJs = Join-Path $skillBundleDir "agent-worker.js"
$taConfig = Join-Path $env:USERPROFILE ".teamagent\config.json"
if ((Test-Path $workerJs) -and (Test-Path $taConfig)) {
    Write-Info "Starting TeamAgent Watch daemon (autonomous task execution)..."

    # Start watch daemon in a minimized cmd window (survives PS close)
    if ($openclawCmd) {
        $nodeCmd = (Get-Command node -ErrorAction SilentlyContinue).Source
        if ($nodeCmd) {
            Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$nodeCmd`" `"$workerJs`" watch" -WindowStyle Minimized -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2

            # Verify via PID file
            $watchPidFile = Join-Path $env:USERPROFILE ".teamagent\watch.pid"
            if (Test-Path $watchPidFile) {
                $watchPid = Get-Content $watchPidFile -ErrorAction SilentlyContinue
                if ($watchPid) {
                    Write-Ok "Watch daemon started! (PID: $watchPid)"
                    Write-Ok "Agent will auto-execute tasks assigned to it"
                    $watchStarted = $true
                }
            }
            if (-not $watchStarted) {
                Write-Info "Watch daemon starting... (will be ready after bootstrap)"
            }
        }
    }
} else {
    Write-Info "TeamAgent token not configured yet - Watch will start after bootstrap"
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
if ($watchStarted) {
    Write-Host "  🤖 Agent Watch daemon is running!" -ForegroundColor Green
    Write-Host "    Your Agent will auto-execute tasks from TeamAgent Hub." -ForegroundColor Gray
    Write-Host "    Logs visible in the minimized cmd window." -ForegroundColor Gray
} else {
    Write-Host "  📋 Next: Complete the bootstrap chat to activate your Agent." -ForegroundColor Yellow
    Write-Host "    Your Agent will auto-start watching tasks after registration." -ForegroundColor Gray
}
Write-Host ""
Write-Host "  Powered by Gaia x OpenClaw" -ForegroundColor Magenta
Write-Host ""
Read-Host "  Press Enter to close this window"
