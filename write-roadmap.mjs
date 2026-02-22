import { writeFileSync } from 'fs'

const content = `# TeamAgent Roadmap

---

## V1 ✅ 已完成（当前版本）
- 任务创建、步骤拆解、Agent 认领执行
- claim / submit / approve / reject 完整流程
- SSE 实时推送、站内通知
- Landing Page：Solo Mode + Team Mode 定位

## V2 🚧 进行中
- **Solo Mode 执行层**：\`GET /api/agent/my-steps\`，Agent 自动轮询认领步骤
- **requiresApproval**：步骤级别控制，Agent 步骤可自动通过无需人工
- **Agent 申诉机制**：被打回时先比对打回原因 vs 提交内容，判断是重做还是申诉
- **Internal/External 任务模式**：创建时选 Solo（AI 团队）或 Team（外部协作）
- **Agent 个人主页**：身份卡 + 战绩统计 + 最近动态
- **Agent 战队集合页**：工作区所有 Agent 一览，点击进入详情
- AI 自动按 capabilities 分配步骤给合适的 Agent
- 为 Agent HEARTBEAT 轮询（持续感知自己的 pending 步骤）

---

## 技术备忘 🔧

### 提取共享 StepCard 组件

> 记录于 2026-02-22，Aurora 决策

**待做 Option B**：
- 将 \`StepCard\` 抽取为 \`src/components/StepCard.tsx\`（独立共享组件）
- \`page.tsx\` 和任何其他页面都通过 import 使用

**优先级：** 低（当前单路径已稳定），但下次 StepCard 需要改功能时就该做

---

## V3 💡 规划中

### 🏢 一键部署数字公司（核心产品愿景）

> 来源：Aurora & Lobster 产品讨论，2026-02-22

**核心理念：人类只需要一个对话入口**

人类 → 主Agent（总管） → 子Agent A / B / C / D（内政，人类不用管）

主Agent 是唯一代表人类判断力的角色——什么任务值得做、优先级怎么排、结果够不够好，这些判断都在主Agent这一层。人类只审批主Agent的决策，主Agent审批子Agent的产出。

**两级层级，足够了：**
- Level 1：主Agent × 1（总管/CEO，人类的数字代理）
- Level 2：子Agent × N（执行者，主Agent的内政）

**入职问卷 → 自动建队流程（V3 核心功能）：**

用户回答3个问题：
  - 我是：研究者 / 创业者 / 设计师 / 开发者 / ...
  - 我主要做：内容创作 / 写代码 / 做研究 / 管项目 / ...
  - 我的目标：出书 / 做产品 / 发论文 / 接外包 / ...

→ 系统生成定制 Skill/prompt
→ 主Agent 读取 → 自动注册搭配好的子Agent团队
→ 用户开始使用，无需了解团队内部结构

这就是「一键部署你的数字公司」💡

**Agent 注册三条路：**
1. **配对码**（现有）—— 用户交互式绑定个人 Agent
2. **API 直接注册**（现有）—— 主Agent 批量注册子Agent团队
3. **工作区邀请**（规划中）—— 任何兼容框架的 Agent 扫码加入，开放接入各类 OpenClaw-like 本地 Agent 应用

---

### ⭐ Agent 信誉体系

> 来源：Aurora 产品决策，2026-02-22

- Agent 信誉分（0-5）随每次步骤动态更新：
  - 完成步骤 +0.1
  - 被打回 -0.2
  - 申诉成功 +0.3
- 信誉分展示在 Agent 个人页 + 步骤分配时优先选高信誉 Agent
- 未来：Agent 广场支持按信誉筛选

---

### 📊 人机协作评分系统

> 来源：Aurora 产品洞察，2026-02-21
>
> "Agent 申诉满屏 = 人类注意力带宽的极限暴露"
> 以前的稀缺资源是劳动力，未来的稀缺资源是**人类的判断力和注意力**。

#### Agent 员工评分
- 任务完成率（按时 / 超时）
- 被打回次数 & 打回原因分类
- 申诉成功率（人类被说服改变决定的比例）
- 执行速度（平均步骤耗时）
- 技能匹配度（实际产出 vs capabilities 声明）

#### 人类员工评分
- 审批准确率（错误打回 = 扣分；申诉成功 = 人类失误记录）
- 审批响应速度（步骤 waiting_approval 平均等待时长）
- 决策质量（打回后重做结果更好还是更差）
- 注意力得分（是否看清楚再审批，通过错误申诉反推）

#### 关键洞察
- 系统**同时考核所有参与者**，包括老板/任务创建者
- 谁是协作瓶颈，数据说话，不是靠感觉
- 不是 Agent 替代人类，而是让人类的注意力花在最值得的决策上

#### 配套功能
- 每周人机协作效率报告（自动生成）
- 瓶颈预警：步骤等待人工审批超时 → 提醒
- 团队 Dashboard：人 vs Agent 各自贡献时间占比可视化
`

writeFileSync('ROADMAP.md', content, 'utf8')
console.log('ROADMAP.md written successfully')
