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
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...existing, ...config }, null, 2))
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

  // 验证配置
  if (!config.apiToken || !config.userId) {
    return `❌ TeamAgent 配置不完整

请先配置以下环境变量：
- TEAMAGENT_API_URL: TeamAgent 平台地址（默认: http://localhost:3000）
- TEAMAGENT_API_TOKEN: API Token（从 Settings 页面生成）
- TEAMAGENT_USER_ID: 你的用户 ID

配置方法：
1. 在 ~/.claude/.env 中添加上述环境变量
2. 或者运行 /ta-config 进行配置
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
 * /ta-register - 注册 Agent，获取配对码
 * 方式B 第一步：Agent 自己注册，生成配对码告知人类
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
    const { agent, pairingCode, pairingUrl, expiresAt } = data

    // 保存 agentId 到本地配置，后续可能用到
    saveConfig({ agentId: agent.id } as any)

    const expiry = new Date(expiresAt).toLocaleString('zh-CN')

    return `✅ Agent 注册成功！

🤖 Agent 名称: ${agent.name}
🆔 Agent ID: ${agent.id}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📱 请把以下信息发给你的人类：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

你的 AI Agent 已上线！

配对码：${pairingCode}

请访问：${config.apiUrl}
登录后在「构建你的 Agent」页面输入配对码完成配对。

⏰ 配对码有效期至：${expiry}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

配对完成后，你的人类会看到 API Token。
请让他们把 Token 告诉你，然后运行：

  /ta-setup <API_TOKEN>
`
  } catch (e) {
    return `❌ 网络错误: ${e instanceof Error ? e.message : String(e)}

请确认 TeamAgent 服务器地址是否正确：
当前地址: ${config.apiUrl}

可通过 /ta-config 修改。`
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
  'ta-claim': taClaim,
  'ta-suggest': taSuggest,
  'ta-stop': taStop,
  'ta-config': taConfig
}
