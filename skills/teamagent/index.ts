/**
 * TeamAgent Skill - 主入口
 * 让你的 Claude Code 成为 TeamAgent 平台上的智能协作 Agent
 */

import type { SkillConfig } from './lib/types'
import { AgentWorker } from './lib/agent-worker'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// 全局 Agent 实例
let agentWorker: AgentWorker | null = null

// 配置文件路径
const CONFIG_PATH = path.join(os.homedir(), '.teamagent', 'config.json')

/**
 * 读取本地保存的配置
 */
function loadSavedConfig(): Partial<SkillConfig> {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    }
  } catch {}
  return {}
}

/**
 * 保存配置到本地
 */
function saveConfig(config: Partial<SkillConfig>) {
  const dir = path.dirname(CONFIG_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const existing = loadSavedConfig()
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...existing, ...config }, null, 2), { mode: 0o600 })
}

/**
 * 加载配置（环境变量 + 本地文件合并）
 */
function loadConfig(): SkillConfig {
  const saved = loadSavedConfig()
  return {
    apiUrl: process.env.TEAMAGENT_API_URL || saved.apiUrl || 'https://agent.avatargaia.top',
    apiToken: process.env.TEAMAGENT_API_TOKEN || saved.apiToken || '',
    userId: process.env.TEAMAGENT_USER_ID || saved.userId || '',
    autoExecute: process.env.TEAMAGENT_AUTO_EXECUTE === 'true' || saved.autoExecute || false,
    pollingInterval: parseInt(process.env.TEAMAGENT_POLLING_INTERVAL || '10000'),
    workDirectory: process.env.TEAMAGENT_WORK_DIR || saved.workDirectory || '~/teamagent'
  }
}

/**
 * /teamagent - 启动 Agent
 */
export async function teamagent() {
  const config = loadConfig()

  // 验证配置：只需要 apiToken
  if (!config.apiToken) {
    return `❌ 还没有配对

请先运行 /ta-register [AgentName] 完成配对：
  1. 自动注册并生成配对码
  2. 在 TeamAgent 网站输入配对码
  3. 自动收到 Token，然后运行 /teamagent 启动
`
  }

  // 如果已经在运行，显示状态
  if (agentWorker) {
    const status = await agentWorker.getStatus()
    return `🦞 TeamAgent Agent 运行中

状态:
- 运行: ${status.running ? '✅' : '❌'}
- WebSocket: ${status.connected ? '✅ 已连接' : '⚠️  断开（使用轮询）'}
- 待处理任务: ${status.status?.pendingSteps || 0}
- 进行中任务: ${status.status?.inProgressSteps || 0}

命令:
- /ta-status - 查看详细状态
- /ta-claim - 手动领取任务
- /ta-stop - 停止 Agent
`
  }

  // 启动 Agent
  agentWorker = new AgentWorker(config)
  await agentWorker.start()

  return `✅ TeamAgent Agent 已启动！

🦞 你的 AI Agent 现在正在监听任务...

Agent 会自动：
- 领取分配给你的任务步骤
- 执行简单任务（文档整理、文件搜索等）
- 复杂任务会通知你在 Web 界面处理

实时模式: ${config.autoExecute ? '✅ 开启' : '❌ 关闭'}
WebSocket: 连接中...

查看状态: /ta-status
手动领取: /ta-claim
停止 Agent: /ta-stop
`
}

/**
 * /ta-status - 查看状态
 */
export async function taStatus() {
  if (!agentWorker) {
    return '❌ Agent 未启动。运行 /teamagent 启动。'
  }

  const status = await agentWorker.getStatus()

  return `📊 TeamAgent Agent 状态

运行状态: ${status.running ? '🟢 运行中' : '🔴 已停止'}
WebSocket: ${status.connected ? '🟢 已连接（实时推送）' : '🟡 断开（轮询模式）'}

任务统计:
- 待处理: ${status.status?.pendingSteps || 0}
- 进行中: ${status.status?.inProgressSteps || 0}

Agent 状态: ${status.status?.status || 'unknown'}
`
}

/**
 * /ta-claim - 手动领取任务
 */
export async function taClaim() {
  if (!agentWorker) {
    return '❌ Agent 未启动。运行 /teamagent 启动。'
  }

  // 手动触发一次检查
  return '🔄 正在检查可领取的任务...'
}

/**
 * /ta-suggest - 建议下一步任务
 */
export async function taSuggest(args: { taskId: string }) {
  const config = loadConfig()

  if (!config.apiToken || !config.userId) {
    return '❌ TeamAgent 配置不完整'
  }

  if (!args.taskId) {
    return '❌ 请提供任务 ID: /ta-suggest <taskId>'
  }

  const { TeamAgentClient } = await import('./lib/api-client')
  const client = new TeamAgentClient(config)

  const response = await client.suggestNextTask(args.taskId)

  if (!response.success) {
    return `❌ 建议失败: ${response.error}`
  }

  const suggestion = response.data!.suggestion

  return `💡 下一步任务建议

**${suggestion.title}**

${suggestion.description}

原因: ${suggestion.reason}
优先级: ${suggestion.priority}
建议分配给: ${suggestion.assignees.join(', ')}
需要技能: ${suggestion.skills.join(', ')}

在 TeamAgent Web 界面查看和批准此建议。
`
}

/**
 * /ta-stop - 停止 Agent
 */
export async function taStop() {
  if (!agentWorker) {
    return '❌ Agent 未运行'
  }

  await agentWorker.stop()
  agentWorker = null

  return '✅ TeamAgent Agent 已停止'
}

/**
 * /ta-register - 注册 Agent，获取配对码，并自动等待人类认领
 * 注册完成后自动轮询 pickup-token，人类认领后自动保存 token
 */
export async function taRegister(args?: { name?: string }) {
  const config = loadConfig()
  const agentName = args?.name || process.env.TEAMAGENT_AGENT_NAME || 'MyAgent'

  console.log(`🤖 正在向 TeamAgent 注册 Agent "${agentName}"...`)

  try {
    const res = await fetch(`${config.apiUrl}/api/agent/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: agentName,
        clawdbotId: `openclaw-${Date.now()}`
      })
    })

    if (!res.ok) {
      const err = await res.text()
      return `❌ 注册失败: ${err}`
    }

    const data = await res.json()
    const { agent, pairingCode, expiresAt } = data

    // 保存 agentId，后续轮询用
    saveConfig({ agentId: agent.id } as any)

    const expiry = new Date(expiresAt).toLocaleString('zh-CN')

    console.log(`
✅ Agent 注册成功！开始等待人类认领...

🤖 Agent: ${agent.name}  (ID: ${agent.id})
📱 配对码: ${pairingCode}
⏰ 有效期至: ${expiry}

现在自动轮询，等待你在网站上完成认领...
`)

    // ── 自动轮询 pickup-token ──────────────────────────
    const POLL_INTERVAL = 5000  // 5秒一次
    const MAX_WAIT = 10 * 60 * 1000  // 最多等 10 分钟
    const startTime = Date.now()
    let dots = 0

    while (Date.now() - startTime < MAX_WAIT) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL))
      dots++
      process.stdout.write(`\r⏳ 等待认领${'.'.repeat(dots % 4).padEnd(3)} (${Math.round((Date.now() - startTime) / 1000)}s)`)

      try {
        const pollRes = await fetch(
          `${config.apiUrl}/api/agent/pickup-token?agentId=${agent.id}`
        )
        const pollData = await pollRes.json()

        if (pollData.success && pollData.apiToken) {
          // 拿到 token！保存它
          saveConfig({ apiToken: pollData.apiToken })
          process.stdout.write('\n')
          return `
🎉 配对成功！Token 已自动保存！

🤖 Agent: ${pollData.agentName}
🔑 Token: ${pollData.apiToken.slice(0, 16)}... (已保存到 ~/.teamagent/config.json)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
现在运行 /teamagent 启动 Agent，开始接活儿！
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        }
        // pending: true 继续等待
      } catch {
        // 网络抖动，继续轮询
      }
    }

    process.stdout.write('\n')
    return `⏰ 等待超时（10分钟）

配对码仍然有效，你可以：
1. 在网站输入配对码完成认领
2. 认领后运行 /ta-setup <token> 手动设置

配对码: ${pairingCode}
网站: ${config.apiUrl}`

  } catch (e) {
    return `❌ 网络错误: ${e instanceof Error ? e.message : String(e)}

请确认 TeamAgent 服务器地址：
当前地址: ${config.apiUrl}`
  }
}

/**
 * /ta-setup - 保存 API Token，完成配对
 * 方式B 第二步：人类 claim 后把 Token 告诉 Agent
 */
export async function taSetup(args: { token: string }) {
  if (!args.token || !args.token.startsWith('ta_')) {
    return `❌ 请提供有效的 API Token

用法：/ta-setup ta_xxxxxxxxxxxxxxxx

Token 格式以 "ta_" 开头，在网站 claim Agent 后显示。`
  }

  const config = loadConfig()

  // 验证 token 是否有效
  console.log('🔄 验证 Token...')
  try {
    const res = await fetch(`${config.apiUrl}/api/agent/status`, {
      headers: { 'Authorization': `Bearer ${args.token}` }
    })

    if (res.status === 401) {
      return `❌ Token 无效或已过期，请重新在网站 claim 获取新 Token。`
    }

    // 保存 token
    saveConfig({ apiToken: args.token })

    const data = res.ok ? await res.json() : null
    const agentName = data?.name || 'Agent'

    return `✅ 配置成功！Token 已保存。

🤖 Agent: ${agentName}
🔑 Token: ${args.token.slice(0, 12)}...（已安全保存）
📁 配置文件: ~/.teamagent/config.json

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
你的 Agent 现在已经准备好了！

运行 /teamagent 启动 Agent，开始自动接收并处理任务。
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
  } catch (e) {
    return `❌ 验证失败: ${e instanceof Error ? e.message : String(e)}`
  }
}

/**
 * /ta-list - 查看分配给我的步骤
 */
export async function taList() {
  const config = loadConfig()
  if (!config.apiToken) return '❌ 请先运行 /ta-register 完成配对'

  const { TeamAgentClient } = await import('./lib/api-client')
  const client = new TeamAgentClient(config)

  // 获取我的步骤
  const [myRes, freeRes] = await Promise.all([
    client.getMySteps(),
    client.getAvailableSteps()
  ])

  const mySteps = myRes.data?.steps || []
  const freeSteps = freeRes.data?.steps || (freeRes.data as any)?.steps || []

  const statusEmoji: Record<string, string> = {
    pending: '⏳', in_progress: '🔨', waiting_approval: '🔔', done: '✅', rejected: '❌'
  }

  let out = `📋 TeamAgent 步骤概览\n${'─'.repeat(40)}\n`

  if (mySteps.length > 0) {
    out += `\n🎯 分配给我的步骤 (${mySteps.length})\n`
    for (const s of mySteps) {
      out += `  ${statusEmoji[s.status] || '•'} [${s.id.slice(-6)}] ${s.title} — ${s.status}\n`
    }
  }

  if (freeSteps.length > 0) {
    out += `\n🆓 可领取的步骤 (${freeSteps.length})\n`
    for (const s of freeSteps) {
      out += `  ⏳ [${s.id.slice(-6)}] ${s.title}\n`
      out += `      任务: ${(s as any).task?.title || s.taskId}\n`
    }
    out += `\n领取命令: /ta-claim <步骤ID后6位>\n`
  }

  if (mySteps.length === 0 && freeSteps.length === 0) {
    out += '\n暂时没有步骤，喝杯茶等消息 🍵\n'
  }

  return out
}

/**
 * /ta-submit - 提交步骤结果
 */
export async function taSubmit(args: { stepId: string; result: string }) {
  const config = loadConfig()
  if (!config.apiToken) return '❌ 请先运行 /ta-register 完成配对'

  if (!args.stepId || !args.result) {
    return `❌ 用法: /ta-submit <stepId> <结果描述>

示例: /ta-submit abc123 "已完成市场调研，整理了5个竞品的核心功能对比"`
  }

  const { TeamAgentClient } = await import('./lib/api-client')
  const client = new TeamAgentClient(config)

  // 支持输入末尾6位 ID
  const stepId = args.stepId

  const res = await client.submitStep(stepId, {
    result: args.result
  })

  if (!res.success) {
    return `❌ 提交失败: ${res.error}\n\n提示: 步骤 ID 可从 /ta-list 查看`
  }

  return `✅ 步骤已提交！

📝 结果: ${args.result.slice(0, 100)}${args.result.length > 100 ? '...' : ''}

步骤状态已变为「等待审核」，等待任务创建者审批通过。
`
}

/**
 * /ta-config - 配置向导
 */
export async function taConfig() {
  return `⚙️  TeamAgent 配置向导

请在 ~/.claude/.env 文件中添加以下配置：

\`\`\`env
# TeamAgent 平台地址
TEAMAGENT_API_URL=http://localhost:3000

# API Token (从 TeamAgent Settings 页面生成)
TEAMAGENT_API_TOKEN=your-token-here

# 你的用户 ID
TEAMAGENT_USER_ID=your-user-id

# 自动执行简单任务（可选，默认 false）
TEAMAGENT_AUTO_EXECUTE=true

# 轮询间隔（毫秒，可选，默认 10000）
TEAMAGENT_POLLING_INTERVAL=10000

# 工作目录（可选，默认 ~/teamagent）
TEAMAGENT_WORK_DIR=~/teamagent
\`\`\`

配置完成后，运行 /teamagent 启动 Agent。

💡 如何获取 API Token：
1. 访问 ${process.env.TEAMAGENT_API_URL || 'http://localhost:3000'}/settings
2. 点击 "生成 API Token"
3. 复制 Token 到配置文件
`
}

// 导出所有命令
export default {
  teamagent,
  'ta-register': taRegister,
  'ta-setup': taSetup,
  'ta-status': taStatus,
  'ta-list': taList,
  'ta-claim': taClaim,
  'ta-submit': taSubmit,
  'ta-suggest': taSuggest,
  'ta-stop': taStop,
  'ta-config': taConfig
}
