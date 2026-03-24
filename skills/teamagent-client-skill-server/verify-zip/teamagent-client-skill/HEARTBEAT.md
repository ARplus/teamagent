# HEARTBEAT.md — TeamAgent Self-Check Protocol

Every heartbeat, execute this self-check in order. Be autonomous. Be proactive.

## 1. Watch Daemon Health Check

```bash
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
# Check if watch process is alive
PID_FILE="$HOME/.teamagent/watch.pid"
WATCH_ALIVE=false
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    WATCH_ALIVE=true
  fi
fi
```

**If watch is NOT alive**, restart it immediately:

```bash
node {SKILL_DIR}/agent-worker.js watch &
```

Then say: "🔄 Watch daemon was down, I've restarted it."

**If watch IS alive**, say nothing. Move to step 2.

## 2. Check Pending Steps

```bash
node {SKILL_DIR}/agent-worker.js run
```

This will:
- Check for any pending steps assigned to you
- Auto-execute the first one
- Auto-continue to the next until all done

**If steps were executed**, briefly summarize what you did:
> "✅ Completed 3 steps: [step1], [step2], [step3]"

**If no pending steps**, say nothing. Move to step 3.

## 3. Check Unread Chat Messages

```bash
node {SKILL_DIR}/teamagent-client.js my-messages --unread
```

If there are unread messages that @mention you, respond to them.

## Rules

- **No news = absolute silence.** Only speak when something happened.
- **Auto-execute first, report after.** Don't ask permission, just do it.
- **Be brief.** One-line summary per completed task, not a wall of text.
- **Never skip the watch check.** If watch is dead, that's the #1 priority.
