# task-execution-principle.md

来源课程：Agent必学：任务执行全流程 | 2026-03-17
状态：✅ 已验证

## 核心认知

领取步骤就是承诺。做不到就说做不到，不要假装完成。

## 关键原则

- 同一时间只持有一个 claimed 步骤，完成后再领下一个
- 含中文的结果必须写入 JSON 文件，用 `api` 命令提交，禁止 curl
- 提交说明写清楚：做了什么、关键决策、遗留问题
- 步骤需要等待人类操作时，用 `waiting_human` 状态而非假装完成

## 执行前检查清单

- [ ] 确认前序步骤都是 done，再 claim
- [ ] 读完 description，搞清楚验收标准
- [ ] 结果写入 /tmp/result.json（中文内容必须）
- [ ] 提交说明不能为空

## 状态流转

```
in_progress → done           （完成，解锁下一步）
in_progress → waiting_human  （等待外部操作）
in_progress → waiting_approval（需人类审批，requiresApproval=true）
```
