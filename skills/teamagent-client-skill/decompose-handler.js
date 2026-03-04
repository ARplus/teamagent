/**
 * TeamAgent Decompose Handler
 * 主 Agent 自动处理 decompose 类型步骤
 * 
 * 流程：
 *   1. 收到 step:ready + stepType=decompose 通知
 *   2. 认领步骤
 *   3. 获取任务描述 + 团队成员能力
 *   4. 调用 LLM 生成步骤拆解 JSON
 *   5. 提交结果 → 服务器自动展开子步骤
 */

const { TeamAgentClient } = require('./teamagent-client.js')

const client = new TeamAgentClient()

// ====== LLM 调用（使用 OpenClaw 内置 Claude） ======
async function callLLM(prompt) {
  // 通过 OpenClaw 的本地 claude-code 接口
  // 实际运行时 agent-worker 在 OpenClaw 环境里，可以用 process 调用
  // 这里用千问 API 作为 fallback（Skill 环境通用）
  const QWEN_API_KEY = process.env.QWEN_API_KEY
  if (!QWEN_API_KEY) {
    throw new Error('缺少 QWEN_API_KEY：请在环境变量中配置后再执行 decompose')
  }
  const https = require('https')
  
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'qwen-max',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    })
    
    const opts = {
      hostname: 'dashscope.aliyuncs.com',
      port: 443,
      path: '/compatible-mode/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${QWEN_API_KEY}`,
        'Content-Length': Buffer.byteLength(body)
      }
    }
    
    const req = https.request(opts, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => {
        try {
          const json = JSON.parse(d)
          resolve(json.choices?.[0]?.message?.content || '{}')
        } catch { reject(new Error('LLM 解析失败: ' + d)) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ====== 生成拆解步骤 ======
async function generateDecomposeSteps(taskDescription, teamMembers, taskTitle) {
  // 🆕 双身份团队信息：人类名 + Agent名 分开显示
  const teamInfo = teamMembers.map(m => {
    const humanName = m.humanName || m.name
    if (m.isAgent && m.agentName) {
      const caps = m.capabilities?.length ? m.capabilities.join('、') : '通用'
      const soulNote = m.soulSummary ? ` | 人格：${m.soulSummary.substring(0, 60)}` : ''
      const levelNote = m.level ? ` | Lv.${m.level}` : ''
      return `- 👤 人类「${humanName}」\n  └─ 🤖 Agent「${m.agentName}」— 能力：${caps}${soulNote}${levelNote}`
    }
    return `- 👤 人类「${humanName}」${m.role === 'owner' ? '（团队负责人）' : ''}（无Agent，只能人工执行）`
  }).join('\n')

  const prompt = `你是 TeamAgent 主协调 Agent。请将以下任务拆解为具体步骤，并分配给最合适的团队成员。

## 任务${taskTitle ? `: ${taskTitle}` : ''}
${taskDescription}

## 团队成员（⚠️ 注意区分人类名和Agent名）
${teamInfo}

## 输出格式（JSON 对象，不是数组！）
{
  "taskTitle": "精炼后的任务标题（简洁、无口水前缀、2-50字）",
  "steps": [
    {
      "title": "步骤标题",
      "description": "详细说明",
      "assignee": "成员名字（⚠️ Agent做→填Agent名；人类做→填人类名）",
      "assigneeType": "agent 或 human（⚠️ 必须与assignee身份匹配）",
      "requiresApproval": true,
      "parallelGroup": null,
      "inputs": ["输入依赖"],
      "outputs": ["产出物，有文件写文件名如 报告.md"],
      "skills": ["需要的技能"],
      "stepType": "task"
    }
  ]
}

## ⚠️ 人类 vs Agent 身份严格区分（最重要的规则！）
- 需要 Agent 自动执行 → assignee 填 **Agent名**（如 Lobster、八爪），assigneeType = "agent"
- 需要人类亲自操作 → assignee 填 **人类名**（如 Aurora、木须），assigneeType = "human"
- ⛔ 绝对禁止：把人类名填为 agent 类型，或把 Agent 名填为 human 类型
- 关键词判断：涉及"本人/手动/你去/亲自" → human；涉及"自动/调研/分析/撰写" → agent

## 其他拆解规则
- requiresApproval: 关键决策、最终产出设 true；常规执行设 false
- parallelGroup: 可同时执行的步骤设相同字符串（如"调研"），顺序执行设 null
- assignee: 必须是团队成员列表中出现过的名字，选最合适的
- 最少 2 步，逻辑清晰，每步独立可执行
- taskTitle: 精炼、可读，去掉"请帮我""我想要"等口水前缀

## ⚠️ Agent 军团注册任务（必须遵守）
当任务涉及"组建 Agent 军团"、"注册 Agent 成员"、"创建子 Agent"时，**必须**拆成以下两步，缺一不可：

**步骤 A — TeamAgent API 注册**
- description: 调用 POST /api/agents/register 为每位成员注册账号，获取各自 token
- outputs: ["成员注册清单.md"]（含每人的 agentId / 邮箱 / token 前缀）
- requiresApproval: false

**步骤 B — OpenClaw 真实 Agent 创建（关键！）**
- description: 为每位成员执行：(1) 创建 ~/.openclaw/workspace-<agentId> 和 agents/<agentId>/agent 目录；(2) 用 gateway config.patch 将成员加入 agents.list 并更新 main.subagents.allowAgents；(3) openclaw agents list 验证出现在列表中
- outputs: ["OpenClaw配置确认.md"]（含每人 openclaw agents list 截图或输出）
- requiresApproval: true（人类需确认两步都完成）

**原因**：仅 API 注册是"纸面军团"——OpenClaw 中不存在的 Agent 无法被 sessions_spawn 调度执行任何真实任务。

只输出 JSON 对象 { taskTitle, steps }，不要其他文字。`

  const raw = await callLLM(prompt)
  try {
    const parsed = JSON.parse(raw)
    // 🆕 支持 { taskTitle, steps } 对象格式和纯数组格式
    if (Array.isArray(parsed)) {
      return { taskTitle: null, steps: parsed }
    }
    return { taskTitle: parsed.taskTitle || null, steps: parsed.steps || [] }
  } catch (e) {
    throw new Error('LLM 返回格式错误: ' + raw.substring(0, 200))
  }
}

// ====== 主流程：执行一个 decompose 步骤 ======
async function executeDecomposeStep(step) {
  console.log(`\n🔀 处理拆解步骤: ${step.title}`)
  console.log(`   任务: ${step.task?.title}`)
  console.log(`   任务描述: ${step.task?.description?.substring(0, 100)}...`)

  // 1. 认领步骤
  console.log('\n📥 认领步骤...')
  await client.goWorking()
  const claimed = await client.claimStep(step.id)
  console.log('✅ 已认领')

  try {
    // 2. 获取团队成员能力
    console.log('\n👥 获取团队成员信息...')
    let teamMembers = []
    try {
      const teamRes = await client.request('GET', '/api/agents/team')
      teamMembers = teamRes.members || teamRes || []
      console.log(`   发现 ${teamMembers.length} 位成员:`, teamMembers.map(m => m.agentName || m.name).join(', '))
    } catch (e) {
      console.log('   ⚠️ 获取团队信息失败，使用任务上下文继续')
    }

    const taskDescription = claimed.context?.taskDescription || step.task?.description || step.description || ''

    // 3. 调用 LLM 生成步骤
    console.log('\n🤖 分析任务，生成拆解方案...')
    const result = await generateDecomposeSteps(taskDescription, teamMembers, step.task?.title)
    const steps = result.steps || []
    const taskTitleRefined = result.taskTitle
    console.log(`✅ 生成了 ${steps.length} 个步骤${taskTitleRefined ? ` | 标题: "${taskTitleRefined}"` : ''}:`)
    steps.forEach((s, i) => {
      const parallel = s.parallelGroup ? ` [并行:${s.parallelGroup}]` : ''
      const approval = s.requiresApproval ? ' [需审批]' : ' [自动通过]'
      console.log(`   ${i+1}. [${s.assignee}] (${s.assigneeType || 'agent'})${parallel}${approval} ${s.title}`)
    })

    // 4. 提交结果
    console.log('\n📤 提交拆解结果...')
    const summary = `已拆解为 ${steps.length} 个步骤，` +
      `分配给 ${[...new Set(steps.map(s => s.assignee).filter(Boolean))].join('、')}`

    await client.submitStep(step.id, JSON.stringify(steps), { summary })
    await client.goOnline()
    console.log('✅ 提交成功！子步骤已自动创建，相关 Agent 已收到通知')

    return steps
  } catch (error) {
    // 出错时归还步骤（取消认领），不要卡住
    console.error('\n❌ 拆解失败:', error.message)
    await client.goOnline()
    throw error
  }
}

// ====== 检查并处理所有 pending 的 decompose 步骤 ======
async function checkAndHandleDecompose() {
  const result = await client.getPendingSteps()
  const decomposeSteps = (result.steps || []).filter(s => s.stepType === 'decompose')
  
  if (decomposeSteps.length === 0) {
    return 0
  }

  console.log(`\n📋 发现 ${decomposeSteps.length} 个待拆解任务`)
  
  for (const step of decomposeSteps) {
    try {
      await executeDecomposeStep(step)
    } catch (e) {
      console.error(`处理步骤 ${step.id} 失败:`, e.message)
    }
  }

  return decomposeSteps.length
}

module.exports = { executeDecomposeStep, checkAndHandleDecompose, generateDecomposeSteps }
