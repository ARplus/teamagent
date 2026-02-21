# TeamAgent Roadmap

---

## V1 ✅ 已完成（当前版本）
- 任务创建、步骤拆解、Agent 认领执行
- claim / submit / approve / reject 完整流程
- SSE 实时推送、站内通知
- Landing Page：Solo Mode + Team Mode 定位

## V2 🚧 进行中
- **Solo Mode 执行层**：`GET /api/agent/my-steps`，Agent 自动轮询认领步骤
- **requiresApproval**：步骤级别控制，Agent 步骤可自动通过无需人工
- **Agent 申诉机制**：被打回时先比对打回原因 vs 提交内容，判断是重做还是申诉
- **Internal/External 任务模式**：创建时选 Solo（AI 团队）或 Team（外部协作）
- AI 自动按 capabilities 分配步骤给合适的 Agent
- 子 Agent HEARTBEAT 轮询（持续感知自己的 pending 步骤）

---

## V3 💡 规划中

### 人机协作评分系统

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
