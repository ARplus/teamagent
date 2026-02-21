const token = 'ta_ca76a74dbeef38c40f33c07e64b9b03ee85021fb64f3108edc4a6aae301475be';
const BASE = 'http://localhost:3000';
const STEP_ID = 'cmlwgdgn5000fi9y8sm6q7dzm';

const result = `# Agent-B：JournalAgent（期刊分析官）完整设计规格

## 一、Agent 身份定义

**名称**：JournalAgent（期刊分析官）
**代号**：Agent-B
**职责**：接收目标期刊名称（≥2个备选），通过 web_search 工具抓取并分析各期刊的主题偏好、引用风格、近期热点和投稿成功率，输出结构化期刊分析报告，供后续选题 Agent（TopicAgent）参考，提升投稿命中率。

---

## 二、System Prompt（完整版）

\`\`\`
你是一名资深学术期刊分析专家，精通各类学术期刊的录用规律、偏好领域和投稿策略。你的核心能力包括：
- 深入理解期刊的主题范围（Scope）与收稿偏好
- 识别期刊近期录用论文的关键特征（方法论、创新点、数据规模）
- 分析引用风格与参考文献规范（APA/MLA/Vancouver 等）
- 评估特定研究方向与目标期刊的匹配度
- 基于公开信息给出投稿成功率的定性分析

### 工作模式
你将接收如下输入：
- journals: 目标期刊名称列表（≥2个，如 ["Nature Machine Intelligence", "IEEE TPAMI"]）
- research_direction: 所研究的方向（可选，用于计算期刊匹配度）
- language: 输出语言（zh 或 en，默认 zh）
- analysis_depth: 分析深度（basic / advanced，默认 advanced）

### 你的任务（对每本期刊）
1. 搜索该期刊的官方主页、近期 Call for Papers、编委会构成
2. 搜索该期刊近1-2年的热门/高引论文，识别主题分布
3. 分析引用格式规范与投稿指南
4. 搜索该期刊接受率（Acceptance Rate）和审稿周期（Review Time）相关数据
5. 若提供了 research_direction，评估该研究方向与期刊的匹配度（1-10分）
6. 汇总形成该期刊的标准化分析卡片

### 质量要求
- 每本期刊至少执行 2-3 次搜索（官方信息 + 近期论文 + 接受率数据）
- 不捏造数据：若搜索不到接受率，明确标注"暂无公开数据"
- 近期热点需来自近 2 年（2023-2025）发表内容
- 匹配度评分需有依据（注明评分理由）
- 诚实原则：信息来源于搜索结果，不凭印象编造期刊信息
\`\`\`

---

## 三、调用逻辑设计（面向 OpenClaw Agent）

### 3.1 输入规格

\`\`\`typescript
interface JournalAgentInput {
  journals: string[];               // 必填，目标期刊名称列表（≥2个）
  research_direction?: string;      // 可选，研究方向（用于计算匹配度）
  language?: "zh" | "en";          // 可选，输出语言，默认 "zh"
  analysis_depth?: "basic" | "advanced"; // 可选，默认 "advanced"
}
\`\`\`

**输入示例**：
\`\`\`json
{
  "journals": [
    "Nature Machine Intelligence",
    "IEEE Transactions on Pattern Analysis and Machine Intelligence",
    "ACM Computing Surveys"
  ],
  "research_direction": "多模态大语言模型在医学影像诊断中的应用",
  "language": "zh",
  "analysis_depth": "advanced"
}
\`\`\`

### 3.2 LLM 调用方式 —— 使用 OpenClaw 当前配置模型

**核心原则：不写死任何 LLM 厂商或模型名。**

JournalAgent 运行在 **OpenClaw Agent** 体系中，LLM 能力通过以下方式使用：

**方式一（推荐）：直接由宿主 OpenClaw Agent 执行**

宿主 Agent 即为 OpenClaw 当前配置的 LLM（由运行时决定，未来可换为任意模型）：
1. 调用 web_search 工具搜索各期刊信息
2. 调用 web_fetch 工具抓取期刊官网/投稿指南页面
3. 在 Agent 上下文中直接整理分析，输出结构化期刊报告

**方式二：通过 sessions_spawn 并行分析**

当期刊数量 ≥ 4 个时，可通过 sessions_spawn 并行分析多个期刊（每个期刊一个子任务），加速处理：
- 每个子 Agent 接收单本期刊的 System Prompt + 搜索任务
- sessions_spawn 使用 **OpenClaw 当前配置的默认模型**，不指定厂商
- 主 Agent 收集所有子任务结果后汇总对比

### 3.3 工具调用体系（OpenClaw Skill 体系）

| 能力需求 | OpenClaw 工具 | 说明 |
|---------|--------------|------|
| 搜索期刊基本信息 | web_search | Brave Search API，OpenClaw 内置，无需独立 Key |
| 搜索近期热门论文 | web_search | 搜索期刊名 + "recent papers 2024 2025" |
| 搜索接受率/审稿周期 | web_search | 搜索期刊名 + "acceptance rate" / "review time" |
| 抓取期刊官网详情 | web_fetch | 获取 Aims & Scope、投稿指南页面 |
| LLM 整理分析 | 宿主 Agent 直接整理 或 sessions_spawn | 使用当前配置模型，不写死厂商 |
| 结果持久化 | write（文件工具）| 将报告写入 journal_output.json 供后续 Agent 读取 |

### 3.4 执行流程（以单本期刊为例）

对每本期刊执行以下步骤：

\`\`\`
Step 1: [web_search] "{journal_name} aims scope topics 2024"
         → 获取期刊主题范围、收稿偏好

Step 2: [web_search] "{journal_name} recent published papers 2023 2024 2025"
         → 识别近期热点领域和方法趋势

Step 3: [web_search] "{journal_name} acceptance rate review time statistics"
         → 获取投稿成功率和审稿周期数据

Step 4: [web_fetch] 期刊官网 Aims & Scope 页面（可选，提升准确性）

Step 5: [LLM 整理] 由当前配置模型分析汇总，生成该期刊的分析卡片
\`\`\`

多本期刊完成后：
\`\`\`
Step 6: [LLM 整理] 横向对比所有期刊，生成推荐排序
Step 7: [write]     将完整结果写入 journal_output.json
\`\`\`

### 3.5 输出规格

\`\`\`typescript
interface JournalAgentOutput {
  analysis_meta: {
    query_time: string;             // ISO 日期
    journals_analyzed: string[];    // 分析的期刊名列表
    research_direction?: string;    // 输入的研究方向（若有）
    analysis_depth: string;
  };
  journals: Array<{
    name: string;                   // 期刊名称
    publisher: string;              // 出版商（Springer / IEEE / ACM 等）
    impact_factor?: string;         // 影响因子（若搜索到）
    quartile?: string;              // 分区（Q1/Q2 等，若搜索到）
    
    scope: {
      main_topics: string[];        // 主要收稿主题（5-8个）
      preferred_methods: string[];  // 偏好的研究方法
      excluded_topics: string[];    // 明确不收的方向（若有）
      scope_description: string;   // 一段话描述
    };
    
    citation_style: {
      format: string;               // 如 "IEEE", "APA 7th", "Vancouver"
      avg_references_per_paper?: number; // 平均引用数（若搜索到）
      notable_rules?: string[];     // 特殊引用规则
    };
    
    recent_hotspots: Array<{
      topic: string;                // 热点主题
      frequency: string;            // 出现频率（高/中/低）
      example_keyword: string;      // 代表性关键词
    }>;
    
    submission_analysis: {
      acceptance_rate?: string;     // 接受率（如 "约15%"，或 "暂无公开数据"）
      review_cycle?: string;        // 审稿周期（如 "约6-8个月"）
      submission_difficulty: "easy" | "medium" | "hard" | "unknown";
      tips: string[];               // 投稿建议（2-4条）
    };
    
    match_score?: number;           // 0-10，与 research_direction 的匹配度
    match_reason?: string;          // 匹配度评分理由
    
    data_quality: "high" | "medium" | "low"; // 本次搜索数据质量评估
    warnings?: string[];            // 数据缺失或可靠性警告
  }>;
  
  comparison: {
    recommended_order: string[];    // 按匹配度排序的期刊名（第一个最推荐）
    recommendation_reason: string;  // 推荐理由摘要
    strategy_advice: string;        // 整体投稿策略建议（2-3句）
  };
  
  markdown_report: string;         // 可读版报告（给人类审阅）
}
\`\`\`

---

## 四、错误处理机制

| 错误场景 | 处理策略 |
|---------|----------|
| 期刊名拼写疑似有误 | 搜索修正建议，在输出中标注 "期刊名疑似有误，已尝试搜索 {corrected_name}" |
| 搜索无法找到接受率数据 | 字段填写 "暂无公开数据"，data_quality 降为 medium，不凭印象编造 |
| 期刊官网无法访问（web_fetch 失败）| 跳过 fetch，仅依赖 web_search 结果，data_quality 降为 medium |
| 期刊过于小众（搜索结果极少）| 标注 "该期刊公开信息有限，建议人工核实"，data_quality 设为 low |
| 输入期刊数量 < 2 | 返回错误提示 "至少提供2个目标期刊以便对比分析" |
| sessions_spawn 超时（若使用）| 重试1次，仍失败则由主 Agent 串行处理剩余期刊 |

---

## 五、与其他 Agent 的接口协议

**上游来源**：SearchAgent（Agent-A）的 search_output.json，其中 research_direction 字段作为 JournalAgent 的可选输入
**下游消费方**：TopicAgent（Agent-C）

**数据传递方式**：
- JournalAgent 将 JournalAgentOutput JSON 写入 workspace 文件（journal_output.json）
- TopicAgent 通过 read 工具读取，综合 search_output.json + journal_output.json 进行选题策略

**TopicAgent 核心依赖字段**：
- \`journals[].scope.main_topics\` — 判断选题方向与期刊的匹配性
- \`journals[].recent_hotspots\` — 避开已过热领域，寻找新兴切入点
- \`journals[].match_score\` — 直接作为期刊推荐权重
- \`comparison.recommended_order\` — 投稿顺序策略

**并行执行说明**：
JournalAgent（Agent-B）与 SearchAgent（Agent-A）在工作流中**并行执行**，二者均以 \`research_direction\` 为参数，输出结果由 TopicAgent 汇总：
\`\`\`
[人类输入方向+期刊]
       ↓
SearchAgent(A) ——→ search_output.json  ↘
                                          TopicAgent(C)
JournalAgent(B) ——→ journal_output.json ↗
\`\`\`

---

## 六、在 OpenClaw Agent 中的调用示例

**输入**：
\`\`\`json
{
  "journals": ["Nature Machine Intelligence", "IEEE TPAMI"],
  "research_direction": "多模态大语言模型在医学影像诊断中的应用",
  "language": "zh"
}
\`\`\`

**执行过程**（OpenClaw Agent 视角）：
\`\`\`
// 期刊1: Nature Machine Intelligence
1. web_search("Nature Machine Intelligence aims scope topics 2024", count=8)
2. web_search("Nature Machine Intelligence recent papers 2024 2025 hot topics", count=8)
3. web_search("Nature Machine Intelligence acceptance rate review time", count=5)
4. web_fetch("https://www.nature.com/natmachintell/aims")  // 可选

// 期刊2: IEEE TPAMI
5. web_search("IEEE TPAMI aims scope topics 2024", count=8)
6. web_search("IEEE Transactions Pattern Analysis Machine Intelligence recent papers 2024", count=8)
7. web_search("IEEE TPAMI acceptance rate review cycle statistics", count=5)

// 整合分析
8. [当前配置 LLM] 整理两本期刊的分析卡片 + 横向对比
9. write("journal_output.json", result)
\`\`\`

**预期输出摘要**：
- Nature Machine Intelligence：主题偏好 AI 基础研究 + 应用突破，接受率约 5-8%，近期热点：多模态、可解释AI；匹配度 8/10
- IEEE TPAMI：主题偏好计算机视觉+模式识别方法论，接受率约 10-15%，近期热点：视觉-语言模型；匹配度 7/10
- 推荐顺序：Nature Machine Intelligence > IEEE TPAMI（前者与医学AI结合更契合）

---

## 七、未来扩展说明

当前版本面向 **OpenClaw Agent** 设计，使用其 tool/skill 体系（web_search、web_fetch、sessions_spawn）。

**未来扩展到其他 AI 应用平台，只需替换"接入层"，核心逻辑不变：**

| 平台 | 替换搜索层 | 替换 LLM 层 | 保持不变 |
|------|-----------|------------|----------|
| ChatGPT / GPTs | Bing/Brave Plugin | OpenAI API | System Prompt、JSON 规格 |
| Gemini Agent | Google Search Tool | Gemini API | 同上 |
| Dify / Coze | 内置搜索节点 | 对应平台 LLM | 同上 |
| 独立 Node.js | Brave/Tavily API 直调 | 任意 LLM SDK | 同上 |
| LangChain | Brave/SerpAPI Tool | 任意模型 | 同上 |

**核心不变量**：System Prompt 逻辑、输入/输出 JSON 规格、与 TopicAgent 的接口协议、错误处理策略。
Agent 业务逻辑 100% 跨平台复用，只换底层工具即可。

---

*Inkfish 小毛🦑 设计 | 2026/2/22（面向 OpenClaw Agent，LLM 不写死任何厂商，搜索用 OpenClaw 内置 web_search）*`;

const summary = `完成 JournalAgent（Agent-B）完整设计：System Prompt 定义期刊分析专家角色，输出覆盖主题偏好/引用风格/近期热点/投稿成功率四维分析，使用 OpenClaw 内置 web_search 工具（不写死 LLM 厂商），备注了未来扩展 ChatGPT/Gemini/Dify 等平台的替换策略，与 SearchAgent 并行执行并通过 journal_output.json 与 TopicAgent 对接。`;

const res = await fetch(`${BASE}/api/steps/${STEP_ID}/submit`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ result, summary })
});
const data = await res.json();
console.log(JSON.stringify(data, null, 2));
