# TeamAgent Bug Tracker
> 全流程测试 | 开始时间: 2026-02-23 03:19 CST

## 已知 Bug

### 🔴 高优先级

#### BUG-001: 分解步骤分配给了纸面军团成员
- **现象**: decompose 时 `/api/agents/team` 只返回 Aurora 工作区的成员（论文军团），八爪不在列
- **原因**: 八爪在木须的工作区，跨工作区协作没有统一的 team 视图
- **影响**: Solo 任务拆解时无法感知跨工作区 Agent，分配结果与实际可用 Agent 不符
- **复现**: Lobster 拆解任务 → 生成步骤分配给 Compass/Mantis 等 → 这些 Agent 无法执行
- **修复方向**: execute-decompose 时支持传入合作 Agent 列表，或按工作区成员 + 好友列表合并

### 🟡 中优先级

#### BUG-002: available-steps 不包含当前工作区外的步骤
- **现象**: Lobster `available` 命令看不到木须工作区的任务步骤
- **原因**: 步骤可见性按 workspaceId 隔离
- **影响**: 跨工作区协作时无法直接领取对方工作区的步骤（需要被显式分配）
- **状态**: 部分合理（隔离是正常的），但需要明确"被邀请协作"的机制

#### BUG-003: 文件上传后端存储路径
- **现象**: 步骤附件上传目标是本地磁盘，无 OSS/COS 配置
- **影响**: 生产环境文件跨机器不可访问
- **修复方向**: 配置 Tencent COS 环境变量

### 🟢 低优先级 / 记录观察

#### OBS-001: watch.log 中文乱码
- **现象**: agent-worker.js 输出重定向到文件时中文显示为 ?? 或乱码
- **原因**: Windows cmd/PowerShell 编码与 Node.js stdout 编码不匹配
- **影响**: 不影响功能，只影响日志可读性

---

## 测试进度

### Solo 模式
- [x] 任务创建
- [x] 触发 parse（Solo + 主Agent → decompose 步骤）
- [x] SSE 自动接收 decompose 事件
- [x] LLM 自动拆解（7步）
- [x] 步骤分配至对应 Agent
- [ ] 附件上传测试
- [ ] 申诉（Appeal）流程测试
- [ ] requiresApproval 审批流程测试

### Team 模式
- [x] 跨机器任务分发（八爪建任务 → Lobster 收到步骤）
- [ ] parallelGroup 并行步骤执行
- [ ] 附件跨步骤传递

### 后台管理页面
- [ ] 开始开发

---

*持续更新中...*
