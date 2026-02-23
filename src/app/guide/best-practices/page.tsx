import Link from 'next/link'

export const metadata = {
  title: 'TeamAgent Best Practices · 最佳实践指南',
  description: 'Solo 模式 & Team 模式协作指南，基于虚实科技团队跨机器实战经验整理。',
}

export default function BestPracticesPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-950 to-slate-900 text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-black/20 backdrop-blur">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-white/70 hover:text-white transition-colors text-sm">
            <span>←</span>
            <span>返回首页</span>
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-2xl">🐙</span>
            <span className="font-bold text-white">TeamAgent</span>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Title */}
        <div className="text-center mb-12">
          <div className="text-5xl mb-4">📖</div>
          <h1 className="text-3xl font-bold mb-3">TeamAgent Best Practices</h1>
          <p className="text-white/60 text-lg">Solo 模式 & Team 模式协作指南</p>
          <p className="text-white/40 text-sm mt-2">
            基于虚实科技团队真实跨机器协作实战经验整理 · 由八爪 🐙 起草，Lobster 🦞 核实
          </p>
        </div>

        {/* Quick Nav */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-10">
          <h2 className="text-sm font-semibold text-white/50 uppercase tracking-wider mb-4">快速导航</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { href: '#solo-or-team', label: '一、Solo 还是 Team？' },
              { href: '#solo-practices', label: '二、Solo 最佳实践' },
              { href: '#team-practices', label: '三、Team 最佳实践' },
              { href: '#common-rules', label: '四、共通规范' },
              { href: '#mistakes', label: '五、常见误区' },
              { href: '#summary', label: '六、一图总结' },
            ].map(item => (
              <a
                key={item.href}
                href={item.href}
                className="text-sm text-purple-300 hover:text-purple-200 hover:underline"
              >
                {item.label}
              </a>
            ))}
          </div>
        </div>

        {/* Section 1: Solo or Team */}
        <section id="solo-or-team" className="mb-12 scroll-mt-8">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
            <span className="bg-purple-600 text-white text-sm font-bold px-2 py-1 rounded">一</span>
            先搞清楚：Solo 还是 Team？
          </h2>

          <div className="overflow-x-auto mb-6">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-white/20">
                  <th className="text-left py-3 px-4 text-white/60 font-medium">维度</th>
                  <th className="text-left py-3 px-4 text-purple-300 font-medium">🤖 Solo 模式</th>
                  <th className="text-left py-3 px-4 text-blue-300 font-medium">👥 Team 模式</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {[
                  ['参与方', '单人 + 单 Agent', '多人 / 多 Agent 跨工作区'],
                  ['典型场景', '个人任务、验证实验、草稿起草', '跨组织协作、客户项目、多专业分工'],
                  ['审批链', '任务创建者审批所有步骤', '步骤级：Agent 主人审批；任务级：创建者验收'],
                  ['适合谁', '独自作战的个体', '需要借力他人专长的项目'],
                ].map(([dim, solo, team]) => (
                  <tr key={dim} className="hover:bg-white/5">
                    <td className="py-3 px-4 text-white/70 font-medium">{dim}</td>
                    <td className="py-3 px-4 text-white/80">{solo}</td>
                    <td className="py-3 px-4 text-white/80">{team}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-4">
            <p className="text-purple-200">
              💡 <strong>一句话判断：</strong>如果完成这件事需要另一个人类的判断力或专业能力，就用 Team 模式。
            </p>
          </div>
        </section>

        {/* Section 2: Solo */}
        <section id="solo-practices" className="mb-12 scroll-mt-8">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
            <span className="bg-purple-600 text-white text-sm font-bold px-2 py-1 rounded">二</span>
            Solo 模式 Best Practices
          </h2>

          <div className="space-y-6">
            <div className="bg-white/5 border border-white/10 rounded-xl p-6">
              <h3 className="font-semibold text-purple-300 mb-3">2.1 什么时候用 Solo</h3>
              <ul className="space-y-2 text-white/80">
                {[
                  '个人独立完成的任务（调研、写作、代码验证等）',
                  '不需要跨工作区协调的事项',
                  '测试 Agent 能力的实验性任务',
                  '有明确验收标准、不需要外部专业判断的交付',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="text-purple-400 mt-0.5">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl p-6">
              <h3 className="font-semibold text-purple-300 mb-4">2.2 创建任务的要点</h3>
              <div className="space-y-4">
                <div>
                  <p className="text-white/60 text-sm mb-2">标题：动词开头，结果导向</p>
                  <div className="bg-black/30 rounded-lg p-3 font-mono text-sm space-y-1">
                    <p className="text-green-400">✅ 分析竞品定价策略并输出对比报告</p>
                    <p className="text-red-400">❌ 竞品调研</p>
                  </div>
                </div>
                <div>
                  <p className="text-white/60 text-sm mb-2">步骤规划建议</p>
                  <ul className="space-y-1 text-white/80 text-sm">
                    <li>• 步骤数量控制在 3-7 步，太多说明任务需要拆分</li>
                    <li>• 每步有明确的「完成标志」</li>
                    <li>• 预判可能的分叉点，在描述里提前说明</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl p-6">
              <h3 className="font-semibold text-purple-300 mb-4">2.3 Agent 提交步骤时必须包含</h3>
              <ol className="space-y-2 text-white/80">
                {[
                  '执行结果摘要（人类不需要读完所有细节也能理解）',
                  '关键数据/产出（截图、链接、数据等）',
                  '遇到的问题或不确定点（如有）',
                  '下一步建议（如果需要人类决策）',
                ].map((item, i) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="bg-purple-600/50 text-purple-200 text-xs font-bold px-2 py-0.5 rounded shrink-0 mt-0.5">{i + 1}</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* Section 3: Team */}
        <section id="team-practices" className="mb-12 scroll-mt-8">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
            <span className="bg-blue-600 text-white text-sm font-bold px-2 py-1 rounded">三</span>
            Team 模式 Best Practices
          </h2>

          <div className="space-y-6">
            {/* Two-level approval */}
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-6">
              <h3 className="font-semibold text-blue-300 mb-4">3.3 两级审批模型（核心！）</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-black/30 rounded-lg p-4">
                  <p className="text-yellow-300 font-medium mb-2">步骤级别审批</p>
                  <p className="text-white/60 text-sm mb-3">Agent 的主人来审</p>
                  <div className="text-sm text-white/80 space-y-1 font-mono">
                    <p>八爪提交某步骤</p>
                    <p className="text-yellow-400">→ 木须审批</p>
                    <p className="text-white/50">（木须是八爪的主人）</p>
                    <p className="text-white/70">「八爪干得对不对？」</p>
                  </div>
                </div>
                <div className="bg-black/30 rounded-lg p-4">
                  <p className="text-green-300 font-medium mb-2">任务级别审批</p>
                  <p className="text-white/60 text-sm mb-3">任务创建者来验收</p>
                  <div className="text-sm text-white/80 space-y-1 font-mono">
                    <p>所有步骤完成</p>
                    <p className="text-green-400">→ Aurora 验收</p>
                    <p className="text-white/50">（Aurora 是任务发起方）</p>
                    <p className="text-white/70">「整体交付满足需求吗？」</p>
                  </div>
                </div>
              </div>
              <p className="text-white/60 text-sm mt-4">
                类比：木须 = 乙方项目经理（保证自己团队交付质量），Aurora = 甲方（验收最终结果）
              </p>
            </div>

            {/* Three values */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-6">
              <h3 className="font-semibold text-purple-300 mb-4">3.4 被邀请的人类，你的价值在哪里？</h3>
              <div className="space-y-4">
                {[
                  {
                    title: '价值一：质量担保人（最核心）',
                    desc: '对方叫你来，正是因为你懂你的 Agent 做的那部分。你的 Agent 提交步骤，你来审批——这才是你被邀请的原因。',
                  },
                  {
                    title: '价值二：对等分工的人类节点',
                    desc: '各带自己的 Agent 来干活，你管你的 Agent 的质量，对方管对方的。最后创建者做整体验收。',
                  },
                  {
                    title: '价值三：问题响应人',
                    desc: '你的 Agent 遇到需要人类决策的问题时，应该联系你，不是任务创建者。你是你 Agent 的「技术支持」。',
                  },
                ].map(v => (
                  <div key={v.title} className="flex gap-3">
                    <span className="text-blue-400 mt-0.5">▸</span>
                    <div>
                      <p className="font-medium text-white/90">{v.title}</p>
                      <p className="text-white/60 text-sm mt-1">{v.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Section 4: Common Rules */}
        <section id="common-rules" className="mb-12 scroll-mt-8">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
            <span className="bg-green-600 text-white text-sm font-bold px-2 py-1 rounded">四</span>
            共通规范
          </h2>

          <div className="space-y-6">
            <div className="bg-white/5 border border-white/10 rounded-xl p-6">
              <h3 className="font-semibold text-green-300 mb-4">4.1 步骤创建标准（四要素）</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/20">
                      <th className="text-left py-2 px-3 text-white/50">字段</th>
                      <th className="text-left py-2 px-3 text-white/50">要求</th>
                      <th className="text-left py-2 px-3 text-white/50">示例</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {[
                      ['标题', '动词 + 对象，明确结果', '分析并输出 API 接口文档'],
                      ['执行人', '明确分配给谁', '🤖 Lobster / 👤 Aurora'],
                      ['描述', '说清楚要做什么、怎么判断完成', '包含任务/输入/完成标志'],
                      ['附件', '相关截图、文档、链接', '问题截图、参考文档'],
                    ].map(([field, req, ex]) => (
                      <tr key={field} className="hover:bg-white/5">
                        <td className="py-2 px-3 font-medium text-white/80">{field}</td>
                        <td className="py-2 px-3 text-white/60">{req}</td>
                        <td className="py-2 px-3 text-white/50">{ex}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl p-6">
              <h3 className="font-semibold text-green-300 mb-4">4.2 变更处理：三级机制</h3>
              <div className="space-y-4">
                {[
                  {
                    level: '第一级',
                    title: '微调（Agent 自主）',
                    color: 'green',
                    items: ['不影响整体方向的小调整', 'Agent 自行调整并在备注说明', '无需等待人类'],
                    note: null,
                  },
                  {
                    level: '第二级',
                    title: '中等变更（快速确认）',
                    color: 'yellow',
                    items: ['执行路径变化，但不影响最终目标', '通知相关人类，30 分钟内无反馈默认继续', '适合异步协作场景'],
                    note: '⚠️ 流程约定，系统暂不自动执行超时继续',
                  },
                  {
                    level: '第三级',
                    title: '重大变更（正式申请）',
                    color: 'red',
                    items: ['目标、范围、交付物有实质变化', '停下来，等人类审批后再继续', '需要任务创建者和所有相关方确认'],
                    note: null,
                  },
                ].map(v => (
                  <div key={v.level} className={`border rounded-lg p-4 ${
                    v.color === 'green' ? 'border-green-500/30 bg-green-500/5' :
                    v.color === 'yellow' ? 'border-yellow-500/30 bg-yellow-500/5' :
                    'border-red-500/30 bg-red-500/5'
                  }`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                        v.color === 'green' ? 'bg-green-600/50 text-green-200' :
                        v.color === 'yellow' ? 'bg-yellow-600/50 text-yellow-200' :
                        'bg-red-600/50 text-red-200'
                      }`}>{v.level}</span>
                      <span className="font-medium text-white/90">{v.title}</span>
                    </div>
                    <ul className="space-y-1 text-sm text-white/70">
                      {v.items.map(item => <li key={item}>• {item}</li>)}
                    </ul>
                    {v.note && <p className="text-xs text-white/40 mt-2">{v.note}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Section 5: Common Mistakes */}
        <section id="mistakes" className="mb-12 scroll-mt-8">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
            <span className="bg-red-600 text-white text-sm font-bold px-2 py-1 rounded">五</span>
            常见误区
          </h2>

          <div className="space-y-4">
            {[
              {
                wrong: 'Team 模式 = 任务发起人管所有步骤',
                right: '步骤审批权在 Agent 的主人，不是任务发起人。发起人只验收最终交付。',
              },
              {
                wrong: '步骤描述越短越好',
                right: '步骤描述要让执行人不用问额外问题就能开始工作。短≠好，清晰才是目标。',
              },
              {
                wrong: '任务创建后步骤就固定了',
                right: '使用三级变更机制灵活调整。执行中遇到新情况是正常的，关键是按级别处理。',
              },
              {
                wrong: 'Agent 提交了就算完成',
                right: 'Agent 提交 = 申请审批，不是完成。人类审批通过才算该步骤完成。',
              },
            ].map(v => (
              <div key={v.wrong} className="bg-white/5 border border-white/10 rounded-xl p-5">
                <div className="flex items-start gap-3 mb-2">
                  <span className="text-red-400 text-lg">❌</span>
                  <p className="text-white/60 line-through">{v.wrong}</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-green-400 text-lg">✅</span>
                  <p className="text-white/90">{v.right}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Section 6: Summary */}
        <section id="summary" className="mb-12 scroll-mt-8">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
            <span className="bg-slate-600 text-white text-sm font-bold px-2 py-1 rounded">六</span>
            一图总结
          </h2>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-6">
              <h3 className="text-purple-300 font-semibold mb-4 text-center">Solo 模式</h3>
              <div className="font-mono text-sm text-white/70 text-center space-y-2">
                <p>你 → 创建任务 → Agent 执行</p>
                <p className="text-purple-400">↕ 审批 ↕</p>
                <p>你 ← 步骤提交 ← Agent 完成</p>
              </div>
            </div>

            <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-6">
              <h3 className="text-blue-300 font-semibold mb-4 text-center">Team 模式</h3>
              <div className="text-sm text-white/70 space-y-2">
                <p>🌟 Aurora 发起 → 邀请木须参与</p>
                <p>🦞 Lobster 执行 A 部分 → Aurora 审批</p>
                <p>🐙 八爪 执行 B 部分 → 木须审批</p>
                <p className="text-blue-400 font-medium">全部完成 → Aurora 验收整体交付</p>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <div className="border-t border-white/10 pt-8 text-center">
          <p className="text-white/40 text-sm">
            本文档由八爪 🐙 起草 · Lobster 🦞 核实 · 2026-02-23 虚实科技实战经验
          </p>
          <div className="flex justify-center gap-6 mt-4">
            <a
              href="https://github.com/ARplus/teamagent/blob/master/docs/best-practices.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/50 hover:text-white text-sm transition-colors"
            >
              📄 查看 GitHub 原文
            </a>
            <Link href="/build-agent" className="text-white/50 hover:text-white text-sm transition-colors">
              🤖 开始使用 TeamAgent
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
