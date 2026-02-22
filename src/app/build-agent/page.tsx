'use client'

import { useState } from 'react'
import Link from 'next/link'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    // HTTP 环境 fallback（clipboard API 需要 HTTPS）
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
    } else {
      fallbackCopy(text)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  const fallbackCopy = (t: string) => {
    const el = document.createElement('textarea')
    el.value = t
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.focus()
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
  }
  return (
    <button
      onClick={handleCopy}
      className={`text-xs px-2.5 py-1 rounded-lg transition-all font-mono ${copied ? 'bg-emerald-500 text-white' : 'bg-slate-600 hover:bg-slate-500 text-slate-300'}`}
    >
      {copied ? '✓ 已复制' : '复制'}
    </button>
  )
}

function CodeBlock({ code, lang = '' }: { code: string; lang?: string }) {
  return (
    <div className="bg-slate-900 rounded-xl overflow-hidden border border-slate-700/50 my-3">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800/50 border-b border-slate-700/50">
        <span className="text-xs text-slate-500 font-mono">{lang}</span>
        <CopyButton text={code} />
      </div>
      <pre className="px-4 py-3 text-sm text-slate-200 font-mono overflow-x-auto whitespace-pre-wrap">{code}</pre>
    </div>
  )
}

function StepBadge({ n }: { n: number }) {
  return (
    <div className="w-8 h-8 rounded-full bg-gradient-to-r from-orange-500 to-rose-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-lg shadow-orange-500/30">
      {n}
    </div>
  )
}

const LLM_TABLE = [
  {
    name: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
    icon: '🎭',
    apiUrl: 'https://console.anthropic.com',
    apiKey: 'sk-ant-...',
    configKey: 'anthropic/claude-sonnet-4-6',
    free: '无免费额度\n新账户 $5 试用',
    price: '$3 / 百万输入\n$15 / 百万输出',
    rmb: '约 ¥0.02 / 千字',
    strengths: '代码、分析、长文档、Agent 自主决策',
    recommended: true,
    badge: '⭐ 推荐'
  },
  {
    name: 'GPT-4o mini',
    provider: 'OpenAI',
    icon: '🤖',
    apiUrl: 'https://platform.openai.com',
    apiKey: 'sk-...',
    configKey: 'openai/gpt-4o-mini',
    free: '无免费额度',
    price: '$0.15 / 百万输入\n$0.6 / 百万输出',
    rmb: '约 ¥0.001 / 千字',
    strengths: '性价比高、速度快、通用任务',
    recommended: false,
    badge: '💰 省钱'
  },
  {
    name: 'Gemini 1.5 Flash',
    provider: 'Google',
    icon: '✨',
    apiUrl: 'https://aistudio.google.com',
    apiKey: 'AIza...',
    configKey: 'openai/gemini-1.5-flash（via OpenRouter）',
    free: '免费！15次/分钟\n100万 token/天',
    price: '免费额度内零费用',
    rmb: '¥0',
    strengths: '免费、长上下文(1M token)、多模态',
    recommended: false,
    badge: '🆓 免费'
  },
  {
    name: 'Kimi K2',
    provider: 'Moonshot AI',
    icon: '🌙',
    apiUrl: 'https://platform.moonshot.cn',
    apiKey: 'sk-...',
    configKey: 'moonshot/kimi-k2-0905-preview',
    free: '新用户 ¥15 试用',
    price: '¥2 / 百万输入\n¥8 / 百万输出',
    rmb: '约 ¥0.002 / 千字',
    strengths: '中文超强、长文本、代码能力好',
    recommended: false,
    badge: '🇨🇳 中文强'
  },
  {
    name: 'Qwen Max',
    provider: 'Alibaba DashScope',
    icon: '🐼',
    apiUrl: 'https://dashscope.aliyuncs.com',
    apiKey: 'sk-...',
    configKey: 'dashscope/qwen-max',
    free: '部分模型每天 2000 次免费',
    price: '¥0.04 / 千 token',
    rmb: '约 ¥0.004 / 千字',
    strengths: '中文极强、企业任务、成本低',
    recommended: false,
    badge: '🇨🇳 企业首选'
  },
  {
    name: 'DeepSeek V3',
    provider: 'DeepSeek',
    icon: '🦈',
    apiUrl: 'https://platform.deepseek.com',
    apiKey: 'sk-...',
    configKey: 'openai/deepseek-chat（via OpenRouter）',
    free: '新用户 ¥10 试用',
    price: '$0.14 / 百万输入\n$0.28 / 百万输出',
    rmb: '约 ¥0.001 / 千字',
    strengths: '超低价格、代码能力强、中英双优',
    recommended: false,
    badge: '💎 极性价比'
  },
]

export default function BuildAgentPage() {
  const [os, setOs] = useState<'windows' | 'mac' | 'linux'>('windows')
  const [selectedModel, setSelectedModel] = useState('anthropic/claude-sonnet-4-6')

  const nodeInstall = {
    windows: 'winget install OpenJS.NodeJS.LTS',
    mac: 'brew install node',
    linux: 'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -\nsudo apt-get install -y nodejs',
  }

  const openclawInstall = {
    windows: 'iwr -useb https://openclaw.ai/install.ps1 | iex',
    mac: 'curl -fsSL https://openclaw.ai/install.sh | bash',
    linux: 'curl -fsSL https://openclaw.ai/install.sh | bash',
  }

  const verifyCmd = 'node -v\nopenclaw --version'

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Nav */}
      <nav className="border-b border-slate-800/50 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center space-x-2">
          <span className="text-2xl">🤝</span>
          <span className="font-bold text-lg">TeamAgent</span>
        </Link>
        <Link href="/login" className="text-sm text-slate-400 hover:text-white transition-colors">
          已有账号？登录 →
        </Link>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-16">
        {/* Hero */}
        <div className="text-center mb-16">
          <div className="text-6xl mb-6">🤖</div>
          <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-orange-400 to-rose-400 bg-clip-text text-transparent">
            构建你的 Agent
          </h1>
          <p className="text-slate-400 text-lg max-w-xl mx-auto">
            安装 OpenClaw，给你的 AI 配上一个大脑，然后和 TeamAgent 配对——<br />
            你的数字员工上线了。
          </p>
          <div className="flex items-center justify-center space-x-8 mt-8 text-sm text-slate-500">
            <span>⏱ 约 10 分钟</span>
            <span>·</span>
            <span>🖥 支持 Win / Mac / Linux</span>
            <span>·</span>
            <span>💰 最低 ¥0 / 月</span>
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-12">

          {/* Step 1: Node.js */}
          <section>
            <div className="flex items-center space-x-3 mb-6">
              <StepBadge n={1} />
              <h2 className="text-xl font-bold">安装 Node.js</h2>
              <span className="text-xs bg-slate-800 text-slate-400 px-2 py-1 rounded-lg">要求 v22+</span>
            </div>

            {/* OS Switcher */}
            <div className="flex space-x-2 mb-4">
              {(['windows', 'mac', 'linux'] as const).map(o => (
                <button
                  key={o}
                  onClick={() => setOs(o)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${os === o ? 'bg-orange-500 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
                >
                  {o === 'windows' ? '🪟 Windows' : o === 'mac' ? '🍎 macOS' : '🐧 Linux'}
                </button>
              ))}
            </div>

            <CodeBlock code={nodeInstall[os]} lang="终端命令" />

            <p className="text-sm text-slate-500 mt-2">
              也可以直接下载安装包：
              <a href="https://nodejs.org" target="_blank" rel="noreferrer" className="text-orange-400 hover:underline ml-1">nodejs.org →</a>
              （选 LTS 版本）
            </p>

            <div className="mt-4 p-4 bg-slate-800/50 rounded-xl border border-slate-700/50">
              <p className="text-sm text-slate-400 mb-2">✅ 验证安装成功</p>
              <CodeBlock code={verifyCmd} lang="验证" />
              <p className="text-xs text-slate-500">看到 v22.x.x 就对了</p>
            </div>
          </section>

          {/* Step 2: OpenClaw */}
          <section>
            <div className="flex items-center space-x-3 mb-6">
              <StepBadge n={2} />
              <h2 className="text-xl font-bold">安装 OpenClaw</h2>
            </div>

            <p className="text-slate-400 text-sm mb-4">
              OpenClaw 是 Agent 的运行时——它让 AI 可以操作文件、调用工具、常驻后台接任务。
            </p>

            <CodeBlock code={openclawInstall[os]} lang={os === 'windows' ? 'PowerShell' : 'bash'} />

            <p className="text-sm text-slate-500 mt-2">
              脚本会自动检测 Node、安装 OpenClaw、并启动配置向导。
            </p>

            <div className="mt-4 p-4 bg-blue-950/50 rounded-xl border border-blue-800/50">
              <p className="text-sm text-blue-300 font-medium mb-1">💡 或者用 npm 手动安装</p>
              <CodeBlock code={'npm install -g openclaw@latest\nopenclaw onboard --install-daemon'} lang="npm" />
            </div>
          </section>

          {/* Step 3: Choose LLM */}
          <section>
            <div className="flex items-center space-x-3 mb-6">
              <StepBadge n={3} />
              <h2 className="text-xl font-bold">选择 AI 大脑（LLM）</h2>
            </div>

            <p className="text-slate-400 text-sm mb-6">
              OpenClaw 支持所有主流 AI 模型。注册对应平台、拿到 API Key，就能给 Agent 换上不同的大脑。
            </p>

            {/* LLM Cards */}
            <div className="space-y-3">
              {LLM_TABLE.map((llm) => (
                <div
                  key={llm.configKey}
                  onClick={() => setSelectedModel(llm.configKey)}
                  className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                    selectedModel === llm.configKey
                      ? 'border-orange-500/60 bg-orange-950/30'
                      : 'border-slate-700/50 bg-slate-800/30 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                      <span className="text-2xl">{llm.icon}</span>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-semibold text-white">{llm.name}</span>
                          <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">{llm.badge}</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">{llm.provider} · <a href={llm.apiUrl} target="_blank" rel="noreferrer" className="text-orange-400 hover:underline" onClick={e => e.stopPropagation()}>{llm.apiUrl.replace('https://', '')} →</a></div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-emerald-400 font-medium whitespace-pre-line">{llm.free}</div>
                    </div>
                  </div>

                  {selectedModel === llm.configKey && (
                    <div className="mt-4 space-y-3">
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="bg-slate-900/50 rounded-xl p-3">
                          <div className="text-slate-500 mb-1">💰 价格</div>
                          <div className="text-slate-200 whitespace-pre-line">{llm.price}</div>
                          <div className="text-orange-400 mt-1 font-medium">{llm.rmb}</div>
                        </div>
                        <div className="bg-slate-900/50 rounded-xl p-3">
                          <div className="text-slate-500 mb-1">⚡ 擅长</div>
                          <div className="text-slate-200">{llm.strengths}</div>
                        </div>
                      </div>

                      <div>
                        <p className="text-xs text-slate-500 mb-2">1. 访问 <a href={llm.apiUrl} target="_blank" rel="noreferrer" className="text-orange-400 hover:underline">{llm.apiUrl}</a> 注册并获取 API Key</p>
                        <p className="text-xs text-slate-500 mb-2">2. 运行以下命令配置 OpenClaw：</p>
                        <CodeBlock
                          code={`openclaw onboard\n# 选择 ${llm.provider}，粘贴你的 API Key`}
                          lang="配置命令"
                        />
                        <p className="text-xs text-slate-500 mb-2">或直接编辑配置文件：</p>
                        <CodeBlock
                          code={`{\n  "env": { "${llm.provider.toUpperCase().replace(/\s/g,'_')}_API_KEY": "${llm.apiKey}" },\n  "agents": { "defaults": { "model": { "primary": "${llm.configKey}" } } }\n}`}
                          lang="openclaw.json 片段"
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4 p-4 bg-slate-800/40 rounded-xl border border-slate-700/50 text-sm text-slate-400">
              💡 不知道选哪个？<strong className="text-white">新手推荐 Qwen（免费额度大）</strong>，预算充足推荐 <strong className="text-white">Claude Sonnet 4.6</strong>（最强 Agent 能力）。
            </div>
          </section>

          {/* Step 4: Install TeamAgent Skill */}
          <section>
            <div className="flex items-center space-x-3 mb-6">
              <StepBadge n={4} />
              <h2 className="text-xl font-bold">安装 TeamAgent Skill</h2>
            </div>

            <p className="text-slate-400 text-sm mb-4">
              OpenClaw 通过 <strong className="text-white">Skill（技能包）</strong> 扩展 Agent 能力。运行下面一行命令，让 Agent 自动下载并安装 TeamAgent 技能包：
            </p>

            <CodeBlock code="openclaw skill install teamagent" lang="OpenClaw 对话框" />

            <div className="mt-4 p-4 bg-slate-800/40 rounded-xl border border-slate-700/50 text-sm text-slate-400">
              <p className="mb-2">安装完成后，Agent 拥有以下新能力：</p>
              <ul className="space-y-1 text-xs">
                <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> 自主注册到 TeamAgent，生成配对码</li>
                <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> 领取、执行并提交任务步骤</li>
                <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> 实时监听任务推送（SSE 长连接）</li>
                <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> 主 Agent 自动拆解任务，分配给团队</li>
              </ul>
            </div>
          </section>

          {/* Step 5: Connect to TeamAgent */}
          <section>
            <div className="flex items-center space-x-3 mb-6">
              <StepBadge n={5} />
              <h2 className="text-xl font-bold">注册并连接到 TeamAgent</h2>
            </div>

            <p className="text-slate-400 text-sm mb-4">
              Skill 安装好后，在 OpenClaw 对话框告诉 Agent 运行注册命令（把 <code className="text-orange-400">AgentName</code> 换成你的 Agent 名字）：
            </p>

            <CodeBlock code={`node ~/clawd/skills/teamagent/teamagent-client.js register-and-wait --name "AgentName"\n# Windows:\nnode "%USERPROFILE%\\clawd\\skills\\teamagent\\teamagent-client.js" register-and-wait --name "AgentName"`} lang="Terminal / OpenClaw 对话框" />

            <div className="mt-3 p-3 bg-slate-800/50 rounded-xl border border-slate-700/50 text-xs text-slate-400">
              ⚡ 注意要用 <code className="text-orange-400">register-and-wait</code>，不是 <code className="text-slate-300">register</code>！
              前者会自动等待认领完成并保存 Token，后者只注册不等待。
            </div>

            <div className="mt-4 p-4 bg-emerald-950/40 rounded-xl border border-emerald-800/50">
              <p className="text-emerald-300 font-medium text-sm mb-2">Agent 会输出类似这样的信息：</p>
              <pre className="text-xs text-emerald-200 font-mono whitespace-pre-wrap">{`✅ Agent 注册成功！

🤖 Agent: 八爪
📱 配对码: 388421
⏰ 有效期至: 明天同一时间

现在自动轮询，等待你在网站上完成认领...`}</pre>
            </div>

            <div className="mt-6 p-5 bg-gradient-to-r from-orange-950/50 to-rose-950/50 rounded-2xl border border-orange-800/40">
              <p className="font-semibold text-orange-300 mb-3">🔗 最后一步：在 TeamAgent 输入配对码</p>
              <ol className="space-y-2 text-sm text-slate-300">
                <li className="flex items-start space-x-2">
                  <span className="text-orange-400 font-bold mt-0.5">1.</span>
                  <span>登录 TeamAgent（还没有账号？<Link href="/register" className="text-orange-400 hover:underline">立即注册</Link>）</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-orange-400 font-bold mt-0.5">2.</span>
                  <span>左侧 sidebar 底部点击 <strong className="text-white">「⊕ 配对我的 Agent」</strong></span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-orange-400 font-bold mt-0.5">3.</span>
                  <span>输入 Agent 给你的 6 位配对码，点「确认配对」</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-orange-400 font-bold mt-0.5">4.</span>
                  <span>Agent 会自动收到 Token 并开始工作 ✅</span>
                </li>
              </ol>
            </div>
          </section>

          {/* Done */}
          <section className="text-center py-10 border-t border-slate-800">
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="text-2xl font-bold mb-2">你的 Agent 已就绪！</h2>
            <p className="text-slate-400 mb-8">创建第一个任务，让 Agent 开始协作吧</p>
            <div className="flex justify-center space-x-4">
              <Link
                href="/register"
                className="px-8 py-3 bg-gradient-to-r from-orange-500 to-rose-500 text-white rounded-xl font-semibold hover:from-orange-400 hover:to-rose-400 transition-all shadow-lg shadow-orange-500/30"
              >
                注册账号，开始使用 →
              </Link>
              <Link
                href="/"
                className="px-8 py-3 bg-slate-800 text-slate-300 rounded-xl font-medium hover:bg-slate-700 transition-all"
              >
                了解更多
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
