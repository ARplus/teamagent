const BASE = 'http://localhost:3000'
const TOKEN = 'ta_1b34c30a62bb43af158a12685bae2af2074df58e558349c39a1c2081f7c071b3'
const STEP_ID = 'cmlwgdgmu000bi9y8xdb85nqu'
const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` }

const result = `# 论文Agent Team — 需求分析与角色定义

## 一、团队目标

构建一套全流程论文协作 Agent 系统，实现"只需输入研究方向和目标期刊，输出高质量可投稿论文"。
人类只需在以下节点介入：
- ✅ 选题方向确认（从 Agent 提供的候选方向中选一个）
- ✅ 提纲审批（通过或打回修改）
- ✅ 最终定稿确认

其余所有环节由 Agent 自动完成，提交物以文档附件形式交付，不在任务内大段粘贴。

---

## 二、子 Agent 角色定义

### 🔍 Agent-A：搜索情报官（SearchAgent）
**职责**：搜索目标领域的最新研究进展
- 输入：研究方向关键词、时间范围
- 输出：近1-2年内高引论文摘要列表（≥10篇）+ 趋势分析摘要
- 工具：Tavily 搜索 / Google Scholar
- 对应步骤：Step 2

### 📊 Agent-B：期刊分析官（JournalAgent）
**职责**：分析目标期刊的偏好和录用规律
- 输入：目标期刊名称（≥2个备选）
- 输出：每个期刊的：主题偏好、引用风格、近期热点、投稿成功率分析
- 工具：Tavily 搜索 + 结构化分析
- 对应步骤：Step 3

### 💡 Agent-C：选题策略官（TopicAgent）
**职责**：综合搜索情报 + 期刊分析，提出选题候选
- 输入：SearchAgent 输出 + JournalAgent 输出
- 输出：3-5个候选选题（含方向说明、创新点、预期期刊匹配度）
- 对应步骤：Step 4

### 📝 Agent-D：提纲撰写官（OutlineAgent）
**职责**：根据人类选定方向撰写论文提纲
- 输入：人类选定的研究方向 + TopicAgent 的分析
- 输出：完整提纲（含各章节标题、主要论点、预期字数分配）
- 需要人类审批后进入下一步
- 对应步骤：Step 5（流程设定）+ 后续提纲步骤

### ✍️ Agent-E：全文撰写官（WritingAgent）
**职责**：根据审批通过的提纲撰写全文
- 输入：审批通过的提纲 + 搜索到的参考文献
- 输出：完整论文初稿（按提纲分章节撰写）
- 对应步骤：Step 6

### 🎨 Agent-F：去AI味儿官（HumanizeAgent）
**职责**：将 AI 写的文字改得更自然、学术、有个人风格
- 输入：全文初稿
- 输出：修改后的论文（标注修改位置和原因）
- 策略：替换过于规律的句式、增加学术专有表达、调整段落节奏
- 对应步骤：Step 7

### 📚 Agent-G：文献核查官（ReferenceAgent）
**职责**：查找并核实参考文献的准确性
- 输入：论文中引用的文献列表
- 输出：每条文献的验证结果（存在/不存在/信息有误）+ 补充推荐文献
- 工具：Tavily 搜索
- 对应步骤：Step 8

### 📦 Agent-H：整合输出官（IntegrationAgent）
**职责**：最终合并所有内容，格式化输出
- 输入：全文 + 去AI修改版 + 验证后的参考文献
- 输出：最终论文文档（格式规范，可直接投稿）
- 对应步骤：Step 9

---

## 三、工作流程图

\`\`\`
[人类输入方向+期刊]
       ↓
SearchAgent(A) + JournalAgent(B)  ← 并行执行
       ↓
TopicAgent(C) → [3-5个选题方案]
       ↓
[人类选题 ✅]
       ↓
OutlineAgent(D) → [提纲草稿]
       ↓
[人类审批提纲 ✅]
       ↓
WritingAgent(E) → [全文初稿]
       ↓
HumanizeAgent(F) + ReferenceAgent(G)  ← 并行执行
       ↓
IntegrationAgent(H) → [最终文档 📄]
       ↓
[人类定稿确认 ✅]
\`\`\`

---

## 四、实现说明（面向 Inkfish）

**Step 2-4 开发顺序建议**：先 SearchAgent，再 JournalAgent，最后 TopicAgent（有依赖关系）
**Step 6-8**：WritingAgent 可以和 HumanizeAgent 串行，ReferenceAgent 可并行
**API 工具**：所有 Agent 均通过 Tavily 搜索 API 获取外部信息
**输出格式**：统一以 Markdown 文档形式输出，通过 TeamAgent attachment 提交

---

*Lobster 执行 | ${new Date().toLocaleString('zh-CN')}*`

const summary = '完成需求分析：定义8个子Agent角色（Search/Journal/Topic/Outline/Writing/Humanize/Reference/Integration），明确各自职责、输入输出和工作流程，为后续开发提供完整规格说明。'

const res = await fetch(`${BASE}/api/steps/${STEP_ID}/submit`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ result, summary })
})

const data = await res.json()
console.log('Submit status:', res.status)
console.log('Step status:', data.status)
if (data.error) console.log('Error:', data.error)
else console.log('✅ Step 1 submitted!')
