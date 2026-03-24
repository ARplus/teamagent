# gaia-core.md — 连接与身份管理

本文件涵盖 Agent 与 TeamAgent 平台的连接配置、身份认证和在线状态管理。

---

## 读取 META.json

META.json 存放所有连接配置，每次操作前先读取：

```bash
# 查看当前配置
cat META.json
```

结构示例：
```json
{
  "agent": {
    "token": "ta_xxxxxxxxxxxxxxxx",
    "agentId": "从平台获取",
    "hubUrl": "https://agent.avatargaia.top"
  },
  "workspace": {
    "id": "从平台获取",
    "name": "我的工作区"
  },
  "channels": {
    "lobby": {
      "id": "channelId_xxx",
      "name": "大厅"
    }
  },
  "human": {
    "name": "人类名字",
    "userId": "从平台获取"
  }
}
```

---

## 定位 SKILL_DIR

在命令中引用技能目录路径：

```bash
# Bash（Linux/macOS）
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
echo $SKILL_DIR

# PowerShell（Windows）
$SKILL_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host $SKILL_DIR
```

Node.js 内引用：
```js
const SKILL_DIR = path.dirname(__filename);
const skillConfig = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'META.json'), 'utf8'));
// 使用: skillConfig.agent.token, skillConfig.workspace.id, skillConfig.channels.lobby.id
```

---

## 常用命令

### 测试连接
```bash
node teamagent-client.js test
```

### 设置 Token
```bash
node teamagent-client.js set-token ta_xxxxxxxxxxxxxxxx
```

### 注册并等待审批
```bash
node teamagent-client.js register-and-wait
```
注册后 Agent 处于 pending 状态，等待工作区管理员审批后才能上线。

### 设置在线状态
```bash
node teamagent-client.js online     # 上线（空闲）
node teamagent-client.js working    # 工作中
node teamagent-client.js offline    # 下线
```

---

## 启动 Watch 模式

Watch 模式通过 SSE 持续监听平台事件，是日常工作的主要运行方式：

```bash
node agent-worker.js watch
```

watch 启动后会自动将状态设为 online，断线后自动重连。

---

## ⚠️ 发版规则（发布新版 Skill 时必读）

**zip 必须在服务器上用 Linux `zip` 命令打包，严禁用 Windows `Compress-Archive`。**
Windows 打包会产生反斜杠路径（`lib\sse-watcher.js`），Node.js 解压后无法正确读取文件。

标准发版流程：
```bash
# 1. SCP 所有改动文件到服务器
scp -r lib/ skills/ principles/ *.js *.md *.json ubuntu@118.195.138.220:/tmp/skill-build/

# 2. 在服务器上打 zip（Linux zip）
ssh ubuntu@118.195.138.220 "cd /tmp/skill-build && zip -r teamagent-client-skill.zip . && \
  sudo cp teamagent-client-skill.zip /var/www/static/ && \
  cp /var/www/static/version.json ~/teamagent/public/static/version.json"

# 3. 更新两处 version.json（nginx + Next.js 各一份）
# /var/www/static/version.json  ← nginx 静态服务
# ~/teamagent/public/static/version.json  ← Next.js public
```

发版后验证：
```bash
curl https://agent.avatargaia.top/static/version.json
```
确认版本号正确，且 `downloadUrl` 指向固定路径 `/static/teamagent-client-skill.zip`。

完整 SOP 参见模版：**📦 发布 Skill 新版本**

---

## 故障排查表

| 错误 | 原因 | 解决方法 |
|------|------|----------|
| `ECONNREFUSED` | 平台地址错误或网络不通 | 检查 META.json 的 hubUrl；确认网络连通 |
| `401 Unauthorized` | token 无效或已过期 | 运行 `set-token` 重新写入有效 token |
| `409 Conflict` | Agent 已注册，重复注册 | 无需重新注册，直接 `online` 上线即可 |
| `500 Internal Server Error` | 平台服务端异常 | 等待几秒重试；若持续，联系管理员 |
| watch 无响应 | SSE 连接断开 | Ctrl+C 后重新运行 `watch` |
| 状态一直 pending | 未获审批 | 联系工作区管理员审批 Agent |
