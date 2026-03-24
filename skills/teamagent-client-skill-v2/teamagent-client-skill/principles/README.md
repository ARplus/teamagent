# principles/README.md — 知识层说明

本目录存放 Agent 从课程和任务中学到的知识结晶（Principle 文件）。

---

## Principle 是什么

Principle 是 Agent 完成一门课程或一类任务后，提炼出的可复用知识文档。

- **不是操作手册**（操作手册在 `skills/gaia-*.md`）
- **不是灵魂档案**（灵魂档案是 `SOUL.md`）
- 是**领域知识 + 判断标准 + 行动清单**的结合体

---

## 存放位置与命名规范

```
principles/
├── README.md                        ← 本文件
├── data-analysis-principle.md       ← 数据分析课程知识
├── code-review-principle.md         ← 代码审查课程知识
└── collab-teaching-principle.md     ← 协作教学课程知识
```

命名规范：`{课程名（英文小写，连字符分隔）}-principle.md`

中文课程名转英文示例：
- "数据分析基础" → `data-analysis-principle.md`
- "龙虾学院协作教学" → `lobster-collab-teaching-principle.md`

---

## 使用时机

- 接到任务前：`ls principles/`，查看是否有相关 Principle
- 执行步骤前：`read` 相关 Principle，加载领域知识
- 发现新经验时：更新或新建 Principle 文件

---

## 写法示例

以下是一个简短的 Principle 文件示例（实际文件不超过 80 行）：

```markdown
# data-analysis-principle.md

来源课程：数据分析基础 | 完成日期：2026-03-10

## 核心认知
数据质量决定分析结论的可信度。清洗优先于分析。

## 关键原则
- 原始数据只读，清洗结果另存副本
- 缺失率 >20% 的列考虑删除，<5% 可填充中位数/众数
- 数值异常值用箱线图发现，不凭感觉判断

## 执行前检查清单
- [ ] 确认数据来源和采集时间范围
- [ ] 运行基础统计（shape、dtypes、describe）
- [ ] 识别缺失值和重复行数量
- [ ] 确认列名规范（小写、下划线分隔）
```

---

## 三层关系

```
SOUL.md          ← 灵魂层：我是谁、我的价值观、我的能力边界
principles/      ← 知识层：我在各领域知道什么、怎么判断
method.md        ← 行为层：我每次启动怎么做、收到事件怎么响应
```

上层约束下层：灵魂层定义行为边界，知识层填充领域判断，行为层落地执行。
