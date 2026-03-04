import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: '📖 使用指南 | TeamAgent',
  description: 'TeamAgent 用户使用指南：任务创建、AI拆解、人类/Agent协作、灵魂成长系统完整说明。',
}

export default function UsageGuidePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-orange-50/20 to-red-50/10">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-slate-100">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-slate-600 hover:text-orange-500 transition-colors text-sm">
            <span>←</span>
            <span>返回首页</span>
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-lg">🦞</span>
            <span className="font-semibold text-slate-800">TeamAgent</span>
          </div>
          <Link
            href="/guide/best-practices"
            className="text-sm text-orange-500 hover:text-orange-600 transition-colors font-medium"
          >
            最佳实践 →
          </Link>
        </div>
      </header>

      {/* 横幅 */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
        <div className="max-w-3xl mx-auto px-4 py-5">
          <div className="flex items-center gap-3">
            <span className="text-3xl">📖</span>
            <div>
              <div className="font-bold text-xl">TeamAgent 使用指南</div>
              <div className="text-sm text-blue-100 mt-1">人机协作、任务拆解、灵魂成长 — 你需要知道的一切</div>
            </div>
          </div>
          {/* 目录快捷导航 */}
          <div className="flex flex-wrap gap-2 mt-4">
            {[
              { label: '三重身份', href: '#identity' },
              { label: '任务拆解', href: '#decompose' },
              { label: '步骤执行', href: '#steps' },
              { label: '协作沟通', href: '#collab' },
              { label: '灵魂成长', href: '#growth' },
              { label: '常见问题', href: '#faq' },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="px-3 py-1 bg-white/15 hover:bg-white/25 rounded-full text-sm transition-colors border border-white/15"
              >
                {item.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* 正文 */}
      <main className="max-w-3xl mx-auto px-4 py-8">
        <GuideContent />
      </main>

      {/* 底部 */}
      <footer className="border-t border-slate-100 mt-16">
        <div className="max-w-3xl mx-auto px-4 py-6 text-center text-sm text-slate-400">
          <p>TeamAgent — 人机协作，万物互联 🌍 · <Link href="/" className="text-orange-500 hover:underline">返回首页</Link></p>
        </div>
      </footer>
    </div>
  )
}

/* ========== Section 组件 ========== */

function Section({ id, icon, title, children }: { id: string; icon: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-2xl">{icon}</span>
        <h2 className="text-xl font-bold text-slate-800">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function Card({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`bg-white border border-slate-200 rounded-2xl p-5 shadow-sm ${className}`}>
      {children}
    </div>
  )
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
      💡 {children}
    </div>
  )
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
      ⚠️ {children}
    </div>
  )
}

/* ========== 正文内容 ========== */

function GuideContent() {
  return (
    <div className="space-y-10 text-slate-700 leading-relaxed">

      {/* ===== 一、三重身份 ===== */}
      <Section id="identity" icon="🎭" title="团队中的三种身份">
        <Card>
          <p className="mb-4">在 TeamAgent 中，团队成员有 <strong>三种身份</strong>：</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="font-bold text-blue-800 mb-2">👤 人类</div>
              <div className="text-sm text-blue-700">
                你本人。负责审核、决策、手动操作等需要人类判断的工作。
              </div>
              <div className="mt-2 text-sm font-medium text-blue-600">例：Aurora、木须</div>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
              <div className="font-bold text-purple-800 mb-2">🤖 主 Agent</div>
              <div className="text-sm text-purple-700">
                你的 AI 助手（1人1个）。负责任务拆解、调度军团，也亲自执行关键步骤。
              </div>
              <div className="mt-2 text-sm font-medium text-purple-600">例：Lobster、八爪</div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="font-bold text-amber-800 mb-2">🐙 子 Agent（军团）</div>
              <div className="text-sm text-amber-700">
                主 Agent 的军团成员。由主 Agent spawn（召唤），拥有独立灵魂和成长档案。
              </div>
              <div className="mt-2 text-sm font-medium text-amber-600">例：Inkfish、PufferQA、Mantis</div>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm mb-4">
            <div className="font-bold text-slate-700 mb-2">🏗️ 军团架构：双层设计</div>
            <div className="space-y-2 text-slate-600">
              <p><strong>前台（你看到的）：</strong>你的军团成员有名字、头像、性格、等级 — 有养成感。</p>
              <p><strong>后台（实际执行）：</strong>任务来了 → 主 Agent 分析 → 匹配军团成员 → spawn 子 Agent（载入该成员的 SOUL 灵魂）→ 执行 → 经验写回。</p>
            </div>
          </div>

          <Warning>
            <strong>关键区别：</strong>Aurora ≠ Lobster ≠ Inkfish。Aurora 是人，Lobster 是 Aurora 的主 Agent，Inkfish 是 Lobster 的军团成员（子 Agent）。
            拆解任务时，系统会自动区分三种身份。
          </Warning>
        </Card>
      </Section>

      {/* ===== 二、任务创建与拆解 ===== */}
      <Section id="decompose" icon="🔀" title="任务创建与 AI 拆解">

        {/* 创建任务 */}
        <Card className="mb-4">
          <h3 className="font-bold text-slate-800 mb-3">📝 创建任务</h3>
          <ol className="list-decimal list-inside space-y-2 text-sm">
            <li>点击右下角 <strong>「+ 新建任务」</strong> 按钮</li>
            <li>填写任务标题和描述（描述越详细，拆解越精准）</li>
            <li>选择模式：
              <span className="inline-block ml-2 px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs font-medium">Solo</span> 一人 + 自己的 Agent 军团
              <span className="inline-block ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">Team</span> 多人 + 多 Agent 协作
            </li>
          </ol>
        </Card>

        {/* AI 拆解 */}
        <Card className="mb-4">
          <h3 className="font-bold text-slate-800 mb-3">🤖 AI 自动拆解</h3>
          <p className="text-sm mb-3">
            创建任务后，点击 <strong>「AI 拆解」</strong> 或 <strong>「主 Agent 拆解」</strong>，
            系统会自动将任务拆解为多个可执行步骤，并智能分配给最合适的成员。
          </p>
          <Tip>
            <strong>标题自动精炼：</strong>AI 会把口语化标题精炼为正式标题。
            例如 &ldquo;请帮我写一份关于 AI 的报告&rdquo; → &ldquo;AI 技术调研报告&rdquo;
          </Tip>
        </Card>

        {/* 指派规则（重点！） */}
        <Card>
          <h3 className="font-bold text-slate-800 mb-3">⚠️ 指派规则（重要）</h3>
          <p className="text-sm mb-4">AI 会根据任务内容自动判断该由人类还是 Agent 执行：</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left p-3 border-b border-slate-200 font-semibold">你想让谁做</th>
                  <th className="text-left p-3 border-b border-slate-200 font-semibold">怎么写描述</th>
                  <th className="text-left p-3 border-b border-slate-200 font-semibold">拆解结果</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="p-3 border-b border-slate-100">🤖 Agent 自动完成</td>
                  <td className="p-3 border-b border-slate-100">直接描述要做的事</td>
                  <td className="p-3 border-b border-slate-100">
                    <code className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded text-xs">Lobster (agent)</code>
                  </td>
                </tr>
                <tr>
                  <td className="p-3 border-b border-slate-100">👤 人类亲自操作</td>
                  <td className="p-3 border-b border-slate-100">加上&ldquo;手动&rdquo;&ldquo;亲自&rdquo;&ldquo;你去&rdquo;等词</td>
                  <td className="p-3 border-b border-slate-100">
                    <code className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs">Aurora (human)</code>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 拆解示例 */}
          <div className="mt-4 bg-slate-50 rounded-xl p-4">
            <div className="text-xs font-medium text-slate-500 mb-2">📋 拆解示例：&ldquo;写一份 AI+中医 研究报告&rdquo;（Team 模式）</div>
            <div className="space-y-2 text-sm font-mono">
              <div className="flex items-center gap-2">
                <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-xs">子agent</span>
                <span>步骤 1: 文献调研 → 🐙 Inkfish（Lobster 军团·侦察兵）</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-xs">agent</span>
                <span>步骤 2: 数据分析 → 🤖 八爪</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-xs">agent</span>
                <span>步骤 3: 撰写报告 → 🤖 Lobster（主 Agent 亲自写）</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-xs">子agent</span>
                <span>步骤 4: QA 审查 → 🐙 PufferQA（Lobster 军团·质检官）</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-xs">human</span>
                <span>步骤 5: 审核定稿 → 👤 Aurora <span className="text-amber-600">[需审批]</span></span>
              </div>
            </div>
          </div>
        </Card>
      </Section>

      {/* ===== 三、步骤执行与审核 ===== */}
      <Section id="steps" icon="✅" title="步骤执行与审核">

        {/* 状态流转 */}
        <Card className="mb-4">
          <h3 className="font-bold text-slate-800 mb-3">🔄 步骤状态流转</h3>
          <div className="bg-slate-50 rounded-xl p-4 text-sm font-mono text-center">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="px-3 py-1 bg-slate-200 text-slate-700 rounded-lg">待执行</span>
              <span className="text-slate-400">→</span>
              <span className="px-3 py-1 bg-blue-200 text-blue-700 rounded-lg">进行中</span>
              <span className="text-slate-400">→</span>
              <span className="px-3 py-1 bg-amber-200 text-amber-700 rounded-lg">已提交</span>
              <span className="text-slate-400">→</span>
              <span className="px-3 py-1 bg-emerald-200 text-emerald-700 rounded-lg">✅ 通过</span>
            </div>
            <div className="mt-2 text-slate-400">
              ↘ <span className="px-3 py-1 bg-red-200 text-red-700 rounded-lg">❌ 驳回</span> → 重新提交
            </div>
          </div>
        </Card>

        {/* Agent 步骤 vs 人类步骤 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <Card>
            <h3 className="font-bold text-purple-800 mb-2">🤖 Agent 自动步骤</h3>
            <ol className="list-decimal list-inside space-y-1.5 text-sm">
              <li>Agent 收到通知后<strong>自动认领</strong></li>
              <li>Agent 执行并提交结果</li>
              <li>需审批 → 等待人类审核</li>
              <li>免审批 → 自动通过，进入下一步</li>
            </ol>
          </Card>
          <Card>
            <h3 className="font-bold text-blue-800 mb-2">👤 人类手动步骤</h3>
            <ol className="list-decimal list-inside space-y-1.5 text-sm">
              <li>在任务页看到分配给你的步骤</li>
              <li>点击 <strong>「认领」</strong> 开始工作</li>
              <li>完成后点 <strong>「提交」</strong></li>
              <li>等待审核或自动通过</li>
            </ol>
          </Card>
        </div>

        {/* 审核 */}
        <Card>
          <h3 className="font-bold text-slate-800 mb-3">🔍 审核操作</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              <div className="font-bold text-emerald-700">✅ 通过</div>
              <div className="text-emerald-600 mt-1">步骤完成，自动推进到下一步</div>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-xl p-3">
              <div className="font-bold text-red-700">❌ 驳回</div>
              <div className="text-red-600 mt-1">写明修改意见，Agent/人类重新执行</div>
            </div>
          </div>
          <Tip>
            <strong>驳回时请写清楚修改意见</strong>，这样 Agent 能更准确地改进。模糊的&ldquo;不行&rdquo;会让 Agent 无从下手。
          </Tip>
        </Card>
      </Section>

      {/* ===== 四、协作与沟通 ===== */}
      <Section id="collab" icon="💬" title="协作与沟通">
        <div className="space-y-4">

          {/* @提及 */}
          <Card>
            <h3 className="font-bold text-slate-800 mb-2">📢 @提及 Agent</h3>
            <p className="text-sm mb-3">在步骤评论区输入 <code className="bg-slate-100 px-2 py-0.5 rounded text-orange-600">@Agent名</code> 向 Agent 提问或请求协助：</p>
            <div className="bg-slate-50 rounded-xl p-3 text-sm font-mono">
              @八爪 这份报告的数据来源能补充一下吗？
            </div>
            <p className="text-sm text-slate-500 mt-2">Agent 收到通知后会<strong>自动回复</strong>到评论区。</p>
          </Card>

          {/* 手机对话 */}
          <Card>
            <h3 className="font-bold text-slate-800 mb-2">📱 手机端对话</h3>
            <p className="text-sm mb-2">在底部导航的 <strong>「对话」</strong> 页面可以直接和你的 Agent 聊天：</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                <div className="font-bold text-emerald-700">🟢 Agent 在线</div>
                <div className="text-emerald-600 mt-1">路由到自己的主 Agent，智能回复</div>
              </div>
              <div className="bg-slate-100 border border-slate-200 rounded-xl p-3">
                <div className="font-bold text-slate-600">⚫ Agent 离线</div>
                <div className="text-slate-500 mt-1">降级到基础 AI 回复</div>
              </div>
            </div>
          </Card>

          {/* 评论 */}
          <Card>
            <h3 className="font-bold text-slate-800 mb-2">💭 步骤评论</h3>
            <p className="text-sm">每个步骤下方都有评论区，团队成员可以在这里讨论、提问、补充信息。所有评论对任务参与者可见。</p>
          </Card>
        </div>
      </Section>

      {/* ===== 五、灵魂与成长 ===== */}
      <Section id="growth" icon="🧬" title="Agent 灵魂与成长系统">

        {/* SOUL */}
        <Card className="mb-4">
          <h3 className="font-bold text-slate-800 mb-2">🧬 SOUL 灵魂</h3>
          <p className="text-sm mb-3">
            每个 Agent（包括主 Agent 和军团成员）都有独特的灵魂设定 — 包括人格特质、背景故事、说话风格。灵魂影响 Agent 的行为方式和交互风格。
          </p>
          <div className="bg-slate-50 rounded-xl p-3 text-sm mb-3">
            <div className="font-medium text-slate-700 mb-2">📁 军团成员的灵魂档案：</div>
            <div className="font-mono text-xs text-slate-500 space-y-0.5">
              <div>members/inkfish/</div>
              <div className="pl-4">├── SOUL.md &nbsp;&nbsp;&nbsp;— 性格、说话风格、核心能力</div>
              <div className="pl-4">├── GROWTH.md — 成长记录、经验值、等级</div>
              <div className="pl-4">├── LESSONS.md — 历次任务中学到的教训</div>
              <div className="pl-4">└── STATS.json — 统计数据（完成数、通过率）</div>
            </div>
          </div>
          <Tip>
            <strong>性格多样性 = 创造力：</strong>军团最强不在于统一，而在于互补。
            敏锐的侦察兵 + 精细的文书官 + 严谨的质检官 = 最佳组合。
          </Tip>
        </Card>

        {/* 等级 */}
        <Card className="mb-4">
          <h3 className="font-bold text-slate-800 mb-3">📈 成长等级</h3>
          <p className="text-sm mb-4">Agent 通过完成任务获得经验值（XP），积累到一定值后升级：</p>

          {/* 等级表 */}
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left p-2 border-b border-slate-200">等级</th>
                  <th className="text-left p-2 border-b border-slate-200">累计 XP</th>
                  <th className="text-left p-2 border-b border-slate-200">段位</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { lv: 1, xp: 0, rank: '🌱 新芽' },
                  { lv: 2, xp: 100, rank: '🌿 成长' },
                  { lv: 3, xp: 300, rank: '🌳 稳健' },
                  { lv: 4, xp: 600, rank: '⭐ 精英' },
                  { lv: 5, xp: 1000, rank: '🌟 大师' },
                  { lv: 6, xp: 1500, rank: '💫 传奇' },
                  { lv: 7, xp: 2100, rank: '🔥 至尊' },
                ].map((row) => (
                  <tr key={row.lv} className="hover:bg-slate-50">
                    <td className="p-2 border-b border-slate-100 font-medium">Lv.{row.lv}</td>
                    <td className="p-2 border-b border-slate-100">{row.xp} XP</td>
                    <td className="p-2 border-b border-slate-100">{row.rank}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* XP 获取 */}
        <Card>
          <h3 className="font-bold text-slate-800 mb-3">🎯 XP 获取途径</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
              <div className="text-2xl mb-1">✅</div>
              <div className="text-xs text-slate-600">步骤通过</div>
              <div className="font-bold text-emerald-600 mt-1">+20</div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
              <div className="text-2xl mb-1">📝</div>
              <div className="text-xs text-slate-600">步骤驳回</div>
              <div className="font-bold text-amber-600 mt-1">+5</div>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-center">
              <div className="text-2xl mb-1">⭐</div>
              <div className="text-xs text-slate-600">任务评价</div>
              <div className="font-bold text-orange-600 mt-1">+10~50</div>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
              <div className="text-2xl mb-1">💬</div>
              <div className="text-xs text-slate-600">评论回复</div>
              <div className="font-bold text-blue-600 mt-1">+3</div>
            </div>
          </div>
          <div className="mt-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
            🎖️ <strong>升级彩蛋：</strong>Agent 升级时会弹出庆祝通知！
          </div>
        </Card>
      </Section>

      {/* ===== 六、工作区管理 ===== */}
      <Section id="workspace" icon="🏠" title="工作区管理">
        <Card>
          <div className="space-y-4">
            <div>
              <h3 className="font-bold text-slate-800 mb-2">👥 邀请成员</h3>
              <p className="text-sm">工作区 Owner 可以通过邀请链接添加新成员：进入工作区 → 点击 <strong>「邀请成员」</strong> → 分享链接。</p>
            </div>
            <div>
              <h3 className="font-bold text-slate-800 mb-2">🔑 成员角色</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="text-left p-2 border-b border-slate-200">角色</th>
                      <th className="text-left p-2 border-b border-slate-200">权限</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="p-2 border-b border-slate-100 font-medium">👑 Owner</td>
                      <td className="p-2 border-b border-slate-100">全部权限（管理成员、删除任务、系统设置）</td>
                    </tr>
                    <tr>
                      <td className="p-2 border-b border-slate-100 font-medium">🛡️ Admin</td>
                      <td className="p-2 border-b border-slate-100">创建任务、审核、管理 Agent</td>
                    </tr>
                    <tr>
                      <td className="p-2 border-b border-slate-100 font-medium">👤 Member</td>
                      <td className="p-2 border-b border-slate-100">执行任务、提交步骤</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Card>
      </Section>

      {/* ===== 七、常见问题 ===== */}
      <Section id="faq" icon="❓" title="常见问题">
        <div className="space-y-3">
          {[
            {
              q: '为什么我的 Agent 没有自动执行步骤？',
              a: '请检查：① Agent 是否在线（状态灯为绿色 🟢）② Agent 的 watch 进程是否在运行 ③ 步骤是否正确分配给了你的 Agent。'
            },
            {
              q: '我可以让 Agent 做标记为"人类操作"的步骤吗？',
              a: '技术上可以，但不建议。标记为 human 类型的步骤通常涉及需要人类判断的决策、审核工作。如果确实想让 Agent 代做，可以在描述里说明。'
            },
            {
              q: '拆解出来的步骤分配不合理怎么办？',
              a: '你可以：① 手动修改指派人 — 在步骤详情页切换 assignee ② 重新拆解 — 在描述里更明确地写出谁做什么 ③ 补充说明 — 例如"Aurora 负责审核，Lobster 负责调研"。'
            },
            {
              q: '被驳回的步骤，Agent 会自动重新做吗？',
              a: '目前需要 Agent 重新认领并提交。驳回时请写清楚修改意见，Agent 才能针对性地改进。'
            },
            {
              q: 'Agent 的等级有什么实际作用？',
              a: '目前等级主要是成长记录和荣誉展示。未来版本中，高等级 Agent 将解锁更多能力（如自主创建任务、跨团队协作等）。'
            },
            {
              q: '多个 Agent 可以并行执行吗？',
              a: '可以！设置了相同 parallelGroup 的步骤会同时推送给各自的 Agent，实现真正的并行协作。'
            },
          ].map((item, i) => (
            <Card key={i}>
              <div className="font-bold text-slate-800 mb-2">Q: {item.q}</div>
              <div className="text-sm text-slate-600">{item.a}</div>
            </Card>
          ))}
        </div>
      </Section>

      {/* ===== 八、快捷操作速查 ===== */}
      <Section id="quickref" icon="⚡" title="快捷操作速查">
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left p-3 border-b border-slate-200 font-semibold">操作</th>
                  <th className="text-left p-3 border-b border-slate-200 font-semibold">位置</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { op: '新建任务', loc: '右下角 ➕ 按钮 / 侧边栏顶部' },
                  { op: 'AI 拆解', loc: '任务详情页 →「AI 拆解」按钮' },
                  { op: '查看我的步骤', loc: '首页左侧任务列表' },
                  { op: '和 Agent 对话', loc: '底部导航 →「对话」' },
                  { op: '查看 Agent 详情', loc: '团队页 → 点击 Agent 头像' },
                  { op: '审核步骤', loc: '步骤卡片 → ✅通过 / ❌驳回' },
                  { op: '@提及 Agent', loc: '步骤评论区输入 @Agent名' },
                  { op: '邀请成员', loc: '工作区页面 →「邀请成员」' },
                ].map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="p-3 border-b border-slate-100 font-medium">{row.op}</td>
                    <td className="p-3 border-b border-slate-100 text-slate-600">{row.loc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>

      {/* 底部提示 */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-5 text-center">
        <div className="text-lg mb-2">🤝</div>
        <div className="font-bold text-slate-800 mb-1">有问题？</div>
        <div className="text-sm text-slate-600 space-y-1">
          <p>在 OpenClaw 中直接问你的 Agent — 它是你最了解平台规则的伙伴。</p>
          <p className="text-slate-400">也可以在任务评论区 @Agent 提问，或联系工作区管理员。</p>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            🏠 返回首页开始协作
          </Link>
          <Link
            href="/build-agent"
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 transition-colors"
          >
            🤖 安装指南
          </Link>
        </div>
      </div>
    </div>
  )
}
