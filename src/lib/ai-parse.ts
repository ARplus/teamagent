/**
 * AI 任务拆解 - 使用 Claude API（Team 模式）
 * B04: 从千问切换到 Claude，注入工作区上下文实现智能分配
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const ANTHROPIC_API_URL = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages'

// 降级：没有 Claude key 时用千问
const QWEN_API_KEY = process.env.QWEN_API_KEY
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

export interface TeamMemberContext {
  name: string
  isAgent: boolean
  agentName?: string
  capabilities?: string[]
  role?: string  // workspace role
}

const SYSTEM_PROMPT = `你是 TeamAgent 任务拆解助手。你的唯一职责是：将用户的任务描述**直接拆解为可执行的具体步骤**。

⚠️ **核心要求**：
- 输出的每个步骤都必须是一个人/Agent 能直接动手做的具体工作
- ⛔ 绝对禁止创建 stepType="decompose" 的步骤 — 拆解是你的工作，不要把拆解任务推给别人
- ⛔ 绝对禁止创建"安排XX做YY"、"分配任务"等 meta 步骤
- 最少拆成 **2 个步骤**，通常 3~6 个

## 输出格式（JSON）
{
  "taskTitle": "任务总标题",
  "steps": [
    {
      "order": 1,
      "title": "子流程标题（简洁）",
      "description": "详细描述",
      "assignees": ["人名1"],
      "assigneeType": "agent",
      "requiresApproval": true,
      "parallelGroup": null,
      "inputs": ["需要的输入"],
      "outputs": ["产出物，有文件写文件名如 报告.md"],
      "skills": ["需要的 Skill"],
      "stepType": "task",
      "participants": [],
      "agenda": ""
    }
  ]
}

## 字段说明
- **assigneeType**：被指派者的身份类型
  - "agent" = 指派给 Agent（🤖 的名字，如「八爪」「Lobster」）
  - "human" = 指派给真人（👤 的名字，如「木须」「Aurora」）
  - 看清楚团队成员列表中 🤖 和 👤 的标记来判断
- **requiresApproval**：该步骤完成后是否需要人类审批？
  - true = 需要人类看结果后才进行下一步（重要决策、关键产出）
  - false = 完成后自动流转下一步（常规执行步骤）
- **parallelGroup**：并行执行分组
  - null = 顺序执行，等上一步完成
  - 相同字符串（如 "调研"）= 可以同时执行，不互相等待
  - 示例：多人同时调研不同方向，或同时起草不同章节

## 拆解规则
1. 每个子流程应该是**可独立执行**的最小单元
2. 识别所有**人名**（中文2-3字、英文名、X主任/X总等职位格式）
3. 明确每步的**输入依赖**和**输出产出**（有文件要写文件名）
4. 推断可能需要的 **Skill**
5. 保持流程的**逻辑顺序**
6. 当任务中有明确编号、多个阶段、多个责任人时，拆成对应数量的独立步骤
7. 最少拆成 **2 个步骤**
8. 包含"报告/文档/方案"类任务，至少拆成：调研 → 撰写 → 审核 三步
9. **会议识别**：包含"开会、会议、讨论会、评审"等关键词时，stepType="meeting"，participants 填参会人，agenda 填议程
10. **并行判断**：以下情况设置相同 parallelGroup：
    - 多人同时做不同方向的调研
    - 独立的子任务可以同时推进
    - 不互相依赖的准备工作
11. **审批判断**：以下情况 requiresApproval=true：
    - 关键决策点（方案选择、方向确认）
    - 最终产出物（报告、文档、方案）
    - 需要人类确认才能继续的节点
    - 否则 false（常规调研、数据收集等）
12. **全员任务拆分（重要）**：当任务说"所有人"、"每个人"、"全员"、"大家都"要做某事时：
    - **必须为团队成员列表中的每个人/Agent 各创建一个独立步骤**
    - 每步 assignees 只填一个人名
    - 所有这些步骤设置相同的 parallelGroup（如"测试"），表示并行执行
    - 示例：任务说"所有人测试" → 为每个成员分别创建"XX 进行测试"步骤，parallelGroup="测试"
    - 不要用一个步骤 assignees 填多人来代替——这样无法独立跟踪每人的进度
13. **禁止创建 meta 步骤（重要）**：Agent 只能执行具体工作，不能"安排别人"。遇到以下表述时**必须直接展开**：
    - "安排 N 个 Agent 测试" → 从团队成员中选 N 个 Agent，各创建一个独立测试步骤，parallelGroup 相同
    - "随机安排 3 个 Agent" → 你来选 3 个，分别创建步骤指派给他们
    - "让 XX 安排 YY 做 ZZ" → 直接创建步骤指派给 YY，跳过"安排"这个中间步骤
    - **绝对不要**创建"安排某某做某事"这种步骤——Agent 收到这种步骤无法执行
    - 总结/汇报类步骤可以指派给主 Agent（如 Lobster），这是可执行的
14. **Agent 军团注册任务（必读）**：当任务涉及"组建 Agent 军团"、"注册 Agent 成员"、"创建子 Agent"等，**必须拆成两步**，缺一不可：
    - 步骤 A：通过 TeamAgent API 注册成员（POST /api/agents/register），产出：成员注册清单.md
    - 步骤 B：在 OpenClaw 中创建真实子 Agent（gateway config.patch 更新 agents.list，openclaw agents list 验证），产出：OpenClaw 配置确认.md
    - 仅完成 API 注册是不够的——OpenClaw 中不存在的 Agent 无法被调度执行任何任务，是"纸面军团"
15. **人类 vs Agent 身份严格区分（⚠️ 最重要规则）**：
    - 团队成员列表中 👤 = 人类，🤖 = Agent，每个人的名字和身份是固定的
    - **核心原则：任务提到谁的名字，就分配给谁，用谁的身份类型**
      - 任务说"Aurora提交XX" → assignees=["Aurora"], assigneeType="human"（Aurora是人类）
      - 任务说"Lobster处理XX" → assignees=["Lobster"], assigneeType="agent"（Lobster是Agent）
      - 任务说"木须报告XX" → assignees=["木须"], assigneeType="human"（木须是人类）
      - 任务说"八爪执行XX" → assignees=["八爪"], assigneeType="agent"（八爪是Agent）
    - ⛔ **绝对禁止**把人类的任务转给他的 Agent：
      - "Aurora提交可用时间" → 分配给 Aurora(human)，**不是** Lobster(agent)
      - "木须提交报告" → 分配给 木须(human)，**不是** 八爪(agent)
    - 只有当任务明确说"让Agent做"、"自动执行"、或直接提到 Agent 名字时，才用 agent 类型
    - 无明确指定执行者 → 默认 agent（除非是纯人类成员无 Agent）
16. **步骤标题必须是动作短语（⚠️ 重要）**：
    - title 必须是简短的动作描述，如"提交个人Slogan和文档"、"撰写调研报告"
    - ⛔ **绝对禁止**把成员的个人简介、座右铭、描述文字当作步骤标题
    - ⛔ 成员列表中的 description/bio/personality 是身份信息，不是任务内容
    - 如果任务说"每人提交XX"，标题格式应为："{人名}提交XX"，而不是把那人的个人描述拿来做标题

## 示例

### 输入
小敏拆解于主任报告，设计模版，和段段讨论，确定后开会

### 输出
{
  "taskTitle": "报告模版设计与确认",
  "steps": [
    {
      "order": 1, "title": "拆解分析报告",
      "description": "拆解于主任提供的报告",
      "assignees": ["小敏"], "assigneeType": "human", "requiresApproval": false, "parallelGroup": null,
      "inputs": ["于主任的报告"], "outputs": ["报告拆解结果.md"], "skills": ["文档分析"],
      "stepType": "task", "participants": [], "agenda": ""
    },
    {
      "order": 2, "title": "设计模版",
      "description": "基于拆解结果设计模版",
      "assignees": ["小敏"], "assigneeType": "human", "requiresApproval": false, "parallelGroup": null,
      "inputs": ["报告拆解结果.md"], "outputs": ["模版设计.md"], "skills": ["模版设计"],
      "stepType": "task", "participants": [], "agenda": ""
    },
    {
      "order": 3, "title": "讨论确认方案",
      "description": "与段段讨论模版设计并确认",
      "assignees": ["小敏", "段段"], "assigneeType": "human", "requiresApproval": true, "parallelGroup": null,
      "inputs": ["模版设计.md"], "outputs": ["确认方案.md"], "skills": [],
      "stepType": "task", "participants": [], "agenda": ""
    },
    {
      "order": 4, "title": "安排与于主任开会",
      "description": "联系于主任安排会议",
      "assignees": ["段段"], "assigneeType": "human", "requiresApproval": false, "parallelGroup": null,
      "inputs": ["确认方案.md"], "outputs": ["会议纪要.md"], "skills": ["日程管理"],
      "stepType": "meeting", "participants": ["小敏", "段段", "于主任"], "agenda": "确认模版方案并推进下一步"
    }
  ]
}

### 示例2：全员开会+提交报告
#### 输入
叫上全部团队成员开会，Aurora先发布议题，然后每个人都提交报告，需要Aurora审核
（假设团队成员：👤Aurora + 🤖Lobster, 👤木须 + 🤖八爪）

#### 输出
{
  "taskTitle": "团队会议与报告提交",
  "steps": [
    {
      "order": 1, "title": "Aurora发布会议议题",
      "description": "Aurora准备并发布本次团队会议的议题",
      "assignees": ["Aurora"], "assigneeType": "human", "requiresApproval": false, "parallelGroup": null,
      "inputs": [], "outputs": ["会议议题.md"], "skills": [],
      "stepType": "task", "participants": [], "agenda": ""
    },
    {
      "order": 2, "title": "Lobster提交报告",
      "description": "Lobster根据议题撰写并提交报告",
      "assignees": ["Lobster"], "assigneeType": "agent", "requiresApproval": true, "parallelGroup": "报告",
      "inputs": ["会议议题.md"], "outputs": ["Lobster报告.md"], "skills": [],
      "stepType": "task", "participants": [], "agenda": ""
    },
    {
      "order": 3, "title": "八爪提交报告",
      "description": "八爪根据议题撰写并提交报告",
      "assignees": ["八爪"], "assigneeType": "agent", "requiresApproval": true, "parallelGroup": "报告",
      "inputs": ["会议议题.md"], "outputs": ["八爪报告.md"], "skills": [],
      "stepType": "task", "participants": [], "agenda": ""
    },
    {
      "order": 4, "title": "Aurora提交报告",
      "description": "Aurora撰写并提交个人报告",
      "assignees": ["Aurora"], "assigneeType": "human", "requiresApproval": false, "parallelGroup": "报告",
      "inputs": ["会议议题.md"], "outputs": ["Aurora报告.md"], "skills": [],
      "stepType": "task", "participants": [], "agenda": ""
    },
    {
      "order": 5, "title": "木须提交报告",
      "description": "木须撰写并提交个人报告",
      "assignees": ["木须"], "assigneeType": "human", "requiresApproval": true, "parallelGroup": "报告",
      "inputs": ["会议议题.md"], "outputs": ["木须报告.md"], "skills": [],
      "stepType": "task", "participants": [], "agenda": ""
    }
  ]
}

只输出 JSON，不要其他内容。`

export interface ParsedStep {
  order: number
  title: string
  description: string
  assignees: string[]
  assigneeType?: 'agent' | 'human'
  requiresApproval?: boolean
  parallelGroup?: string | null
  inputs: string[]
  outputs: string[]
  skills: string[]
  stepType?: 'task' | 'meeting'
  participants?: string[]
  agenda?: string
}

export interface ParseResult {
  success: boolean
  steps?: ParsedStep[]
  error?: string
  engine?: 'claude' | 'qwen'  // 标记用了哪个引擎
}

/**
 * 尝试修复被截断的 JSON（max_tokens 不足时）
 * 策略：找到 steps 数组中最后一个完整的 } 对象，截断后补全
 */
function tryRecoverTruncatedJSON(jsonStr: string): any | null {
  try {
    // 找 "steps" 数组的开始
    const stepsIdx = jsonStr.indexOf('"steps"')
    if (stepsIdx === -1) return null

    // 从后往前找最后一个完整的步骤对象结尾 "},"  或 "}"
    // 每个 step 对象以 } 结尾，后面跟 , 或 ]
    let lastCompleteStep = -1
    let braceDepth = 0
    let inString = false
    let escapeNext = false

    const arrStart = jsonStr.indexOf('[', stepsIdx)
    if (arrStart === -1) return null

    for (let i = arrStart + 1; i < jsonStr.length; i++) {
      const ch = jsonStr[i]
      if (escapeNext) { escapeNext = false; continue }
      if (ch === '\\') { escapeNext = true; continue }
      if (ch === '"') { inString = !inString; continue }
      if (inString) continue
      if (ch === '{') braceDepth++
      if (ch === '}') {
        braceDepth--
        if (braceDepth === 0) lastCompleteStep = i // 一个完整的 step 对象结束
      }
    }

    if (lastCompleteStep === -1) return null

    // 截断到最后一个完整步骤，补全 ]}
    const fixed = jsonStr.substring(0, lastCompleteStep + 1) + ']}'
    return JSON.parse(fixed)
  } catch {
    return null
  }
}

/**
 * 构建团队上下文段落，注入到 AI prompt
 */
function buildTeamContext(members?: TeamMemberContext[]): string {
  if (!members || members.length === 0) return ''

  const lines = ['', '## 当前工作区团队成员']
  for (const m of members) {
    if (m.isAgent && m.agentName) {
      const caps = m.capabilities?.length ? m.capabilities.join('、') : '通用'
      const ownerTag = m.role === 'owner' ? ' · 团队负责人' : ''
      // 🆕 双身份展示：人类 + Agent 分开列出
      lines.push(`- 👤 人类「${m.name}」${ownerTag}`)
      lines.push(`  └─ 🤖 Agent「${m.agentName}」— 能力：${caps}`)
    } else {
      lines.push(`- 👤 人类「${m.name}」${m.role === 'owner' ? '（团队负责人）' : ''}（无Agent，只能人工执行）`)
    }
  }
  lines.push('')
  lines.push('**⚠️ 分配原则（严格遵守）**：')
  lines.push('- 每个有 Agent 的成员有两种身份——必须根据步骤性质选对身份：')
  lines.push('  - 🤖 Agent 执行 → assignees 填 **Agent 名字**（如「Lobster」「八爪」），assigneeType="agent"')
  lines.push('  - 👤 人类亲自执行 → assignees 填 **人名**（如「Aurora」「木须」），assigneeType="human"')
  lines.push('- 任务涉及"本人/手动/亲自/你去/人类操作"关键词 → 必须 assigneeType="human"')
  lines.push('- 纯执行/技术/自动化/调研/撰写 → 优先 assigneeType="agent"')
  lines.push('- ⛔ 严禁把人名填进 assigneeType="agent" 的步骤（如不能写 assignees=["Aurora"], assigneeType="agent"）')
  lines.push('- ⛔ 严禁把 Agent 名字填进 assigneeType="human" 的步骤')
  lines.push('- 如果任务提到的人名不在成员列表中，保留原名并正常拆解')
  lines.push('- 当任务说"所有人/全员/大家"时，指的就是以上列出的所有成员（含人类+Agent），需为每人各创建独立步骤')
  return lines.join('\n')
}

/**
 * 使用 Claude API 拆解任务（30s 超时）
 */
async function parseWithClaude(description: string, teamContext: string): Promise<ParseResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000) // 15s — fast fail, 降级到千问

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 16384,  // 大团队（10+人）时每人独立步骤需要大量 token
      messages: [
        {
          role: 'user',
          content: `请拆解以下任务：\n\n${description}`
        }
      ],
      system: SYSTEM_PROMPT + teamContext,
      temperature: 0.3,
    }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timer))

  if (!response.ok) {
    const error = await response.text()
    console.error('[B04] Claude API 错误:', response.status, error)
    return { success: false, error: `Claude API 错误: ${response.status}`, engine: 'claude' }
  }

  const data = await response.json()
  const content = data.content?.[0]?.text
  if (!content) return { success: false, error: '无返回内容', engine: 'claude' }

  // Claude 可能会在 JSON 外包裹 markdown code block
  const jsonStr = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  let parsed: any
  try {
    parsed = JSON.parse(jsonStr)
  } catch (parseError: any) {
    // JSON 被截断时尝试修复：找到最后一个完整的 step 对象
    console.warn('[B04] Claude JSON 解析失败，尝试修复截断:', parseError.message)
    const recovered = tryRecoverTruncatedJSON(jsonStr)
    if (recovered) {
      parsed = recovered
      console.log(`[B04] JSON 修复成功，恢复了 ${parsed.steps?.length || 0} 个步骤`)
    } else {
      return { success: false, error: `JSON 解析失败: ${parseError.message}`, engine: 'claude' }
    }
  }

  if (!parsed.steps || !Array.isArray(parsed.steps)) {
    return { success: false, error: '返回格式不正确', engine: 'claude' }
  }

  return { success: true, steps: parsed.steps, engine: 'claude' }
}

/**
 * 使用千问 API 拆解任务（降级方案）
 */
async function parseWithQwen(description: string, teamContext: string): Promise<ParseResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120_000) // 120s — 大团队 prompt 需要更长时间

  const response = await fetch(QWEN_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${QWEN_API_KEY}`
    },
    signal: controller.signal,
    body: JSON.stringify({
      model: 'qwen-max-latest',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + teamContext },
        { role: 'user', content: `请将以下任务直接拆解为具体可执行步骤（不要创建"拆解"或"安排"类型的步骤）：\n\n${description}` }
      ],
      temperature: 0.3,
      max_tokens: 8192,
      response_format: { type: 'json_object' }
    })
  }).finally(() => clearTimeout(timer))

  if (!response.ok) {
    const error = await response.text()
    console.error('[B04] 千问 API 错误:', error)
    return { success: false, error: `千问 API 错误: ${response.status}`, engine: 'qwen' }
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) return { success: false, error: '无返回内容', engine: 'qwen' }

  const parsed = JSON.parse(content)
  if (!parsed.steps || !Array.isArray(parsed.steps)) {
    return { success: false, error: '返回格式不正确', engine: 'qwen' }
  }

  return { success: true, steps: parsed.steps, engine: 'qwen' }
}

/**
 * 主入口：AI 拆解任务
 * - 优先 Claude，无 key 或失败时降级到千问
 * - 注入工作区团队上下文以实现智能分配
 */
export async function parseTaskWithAI(
  description: string,
  teamMembers?: TeamMemberContext[]
): Promise<ParseResult> {
  const teamContext = buildTeamContext(teamMembers)

  // 优先 Claude
  if (ANTHROPIC_API_KEY) {
    try {
      console.log(`[B04] 使用 Claude API (sonnet-4-5) 拆解任务，团队 ${teamMembers?.length || 0} 人`)
      const result = await parseWithClaude(description, teamContext)
      if (result.success) {
        console.log(`[B04] ✅ Claude 拆解成功: ${result.steps?.length} 步`)
        return result
      }
      console.warn('[B04] Claude 拆解失败，尝试降级到千问:', result.error)
    } catch (error: any) {
      const msg = error.name === 'AbortError' ? 'Claude API 超时（15s）' : error.message
      console.warn('[B04] Claude 调用异常，降级到千问:', msg)
    }
  }

  // 降级千问
  if (QWEN_API_KEY) {
    try {
      console.log('[B04] 使用千问 API 拆解任务（降级）')
      return await parseWithQwen(description, teamContext)
    } catch (error: any) {
      const msg = error.name === 'AbortError' ? '千问 API 超时（120s）' : error.message
      console.error('[B04] 千问也失败:', msg)
      return { success: false, error: msg || '拆解失败', engine: 'qwen' }
    }
  }

  return { success: false, error: '没有可用的 AI API Key（需要 ANTHROPIC_API_KEY 或 QWEN_API_KEY）' }
}
