/**
 * TeamAgent Skill - 主入口
 * 让你的 Claude Code 成为 TeamAgent 平台上的智能协作 Agent
 */

import type { SkillConfig } from './lib/types'
import { AgentWorker } from './lib/agent-worker'

// 全局 Agent 实例
let agentWorker: AgentWorker | null = null

/**
 * 加载配置
 */
function loadConfig(): SkillConfig {
  return {
    apiUrl: process.env.TEAMAGENT_API_URL || 'http://localhost:3000',
    apiToken: process.env.TEAMAGENT_API_TOKEN || '',
    userId: process.env.TEAMAGENT_USER_ID || '',
    autoExecute: process.env.TEAMAGENT_AUTO_EXECUTE === 'true',
    pollingInterval: parseInt(process.env.TEAMAGENT_POLLING_INTERVAL || '10000'),
    workDirectory: process.env.TEAMAGENT_WORK_DIR || '~/teamagent'
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
  'ta-status': taStatus,
  'ta-claim': taClaim,
  'ta-suggest': taSuggest,
  'ta-stop': taStop,
  'ta-config': taConfig
}
