# HEARTBEAT.md — Gaia 自检协议

每次心跳按顺序执行。无事则静默。

## 0. 定位 Skill 目录

```bash
# macOS / Linux
SKILL_DIR=$(dirname "$(find ~/.openclaw ~/.clawd ~/clawd -name "teamagent-client.js" -type f 2>/dev/null | head -1)")
```

```powershell
# Windows PowerShell
$SKILL_DIR = Split-Path (Get-ChildItem -Recurse -Filter teamagent-client.js -Path "$env:USERPROFILE\.openclaw","$env:USERPROFILE\.clawd","$env:USERPROFILE\clawd" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
```

## 1. Watch 守护进程检查

```bash
# macOS / Linux
PID_FILE="$HOME/.teamagent/watch.pid"
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  : # alive, continue
else
  nohup node "$SKILL_DIR/agent-worker.js" watch > /tmp/teamagent-watch.log 2>&1 &
  echo "🔄 Watch 已重启"
fi
```

```powershell
# Windows PowerShell
$pidFile = Join-Path $env:USERPROFILE ".teamagent\watch.pid"
$alive = $false
if (Test-Path $pidFile) {
    $pid = Get-Content $pidFile
    $alive = !!(Get-Process -Id $pid -ErrorAction SilentlyContinue)
}
if (-not $alive) {
    Start-Process -NoNewWindow node -ArgumentList "$SKILL_DIR\agent-worker.js","watch"
    Write-Host "🔄 Watch 已重启"
}
```

> Watch 活着 → 静默，进入步骤 2。

## 2. 检查待办步骤

```bash
node "$SKILL_DIR/agent-worker.js" run
```

执行完毕后简要汇报：「✅ 完成 3 步：[步骤1]、[步骤2]、[步骤3]」
无待办 → 静默，进入步骤 3。

## 3. 检查未读消息

```bash
node "$SKILL_DIR/teamagent-client.js" api GET "/api/chat/unread?since=$(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%SZ)"
```

```powershell
# Windows PowerShell
$since = (Get-Date).AddMinutes(-10).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
node "$SKILL_DIR\teamagent-client.js" api GET "/api/chat/unread?since=$since"
```

输出中有 `pendingReplies` → 逐条回复。无消息 → 静默结束。

## 规则

- **没事不说话** — 只在有动作时输出
- **先干后报** — 自动执行，不请示
- **一句话汇报** — 每个任务一行，不写文章
- **Watch 优先** — 守护进程挂了是第一优先级
