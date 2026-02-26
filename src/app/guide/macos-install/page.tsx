import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'

export const metadata: Metadata = {
  title: '🍎 MacOS 安装指南 | OpenClaw',
  description: '专为 MacOS 用户编写的 OpenClaw 安装配置指南，含完整截图，从终端到 Web UI 一步步教你搞定。',
}

function StepNumber({ n }: { n: number }) {
  return (
    <span className="bg-orange-500 text-white w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 shadow-sm shadow-orange-500/30">
      {n}
    </span>
  )
}

function Screenshot({ src, alt, caption }: { src: string; alt: string; caption?: string }) {
  return (
    <figure className="my-4">
      <div className="rounded-xl overflow-hidden border border-slate-200 shadow-sm">
        <Image
          src={src}
          alt={alt}
          width={800}
          height={500}
          className="w-full h-auto"
          unoptimized
        />
      </div>
      {caption && (
        <figcaption className="text-xs text-slate-400 text-center mt-2 italic">{caption}</figcaption>
      )}
    </figure>
  )
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 my-3">
      💡 {children}
    </div>
  )
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800 my-3">
      ⚠️ {children}
    </div>
  )
}

function CodeBlock({ children, lang }: { children: string; lang?: string }) {
  return (
    <pre className="bg-slate-900 text-green-300 rounded-xl p-4 text-sm overflow-x-auto my-3">
      <code>{children}</code>
    </pre>
  )
}

export default function MacOSInstallGuidePage() {
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
            href="/guide/china-install"
            className="text-sm text-orange-500 hover:text-orange-600 transition-colors font-medium"
          >
            Windows 版 →
          </Link>
        </div>
      </header>

      {/* 横幅 */}
      <div className="bg-gradient-to-r from-orange-500 to-rose-500 text-white">
        <div className="max-w-3xl mx-auto px-4 py-5">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🍎</span>
            <div>
              <div className="font-bold text-xl">MacOS 安装指南</div>
              <div className="text-sm text-orange-100">含完整截图 · 从终端到 Web UI · 手把手带你配置</div>
            </div>
          </div>
          {/* 平台切换 */}
          <div className="flex gap-2 mt-4">
            <span className="px-3 py-1 bg-white/25 rounded-full text-sm font-medium backdrop-blur-sm border border-white/20">
              🍎 MacOS（当前）
            </span>
            <Link
              href="/guide/china-install"
              className="px-3 py-1 bg-white/10 rounded-full text-sm hover:bg-white/20 transition-colors border border-white/10"
            >
              🪟 Windows 版
            </Link>
          </div>
        </div>
      </div>

      {/* 正文 */}
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="space-y-10 text-slate-700 leading-relaxed">

          {/* 总览 */}
          <div className="bg-gradient-to-br from-orange-50 to-red-50 border border-orange-200 rounded-2xl p-5">
            <h2 className="text-lg font-semibold text-orange-800 mb-3">🗺️ 安装全流程速查</h2>
            <div className="space-y-2">
              {[
                '打开终端（Terminal）',
                '安装 Homebrew 包管理器',
                '安装 / 升级 Node.js 到 v22+',
                '安装 OpenClaw',
                '配置网关',
                '选择 AI 模型并填入 API Key',
                '配置使用环境',
                '配置技能与钩子',
                '重启网关',
                '选择入门模式',
                '配置处理',
                '选择重置范围',
                '打开 Web UI 开始使用',
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="bg-orange-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-sm text-slate-700">{step}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Step 1: 打开终端 */}
          <section>
            <h2 className="text-xl font-semibold text-orange-700 mb-3 flex items-center gap-2">
              <StepNumber n={1} />
              打开 MacOS 终端
            </h2>
            <p className="mb-3">
              打开 <strong>启动台 (Launchpad)</strong> → 找到 <strong>终端 (Terminal)</strong> 应用，双击打开。
            </p>
            <Screenshot
              src="/guide/macos/step-01.png"
              alt="MacOS 应用程序列表，标注终端位置"
              caption="在启动台或应用程序文件夹中找到「终端」"
            />
            <p className="mt-3">打开后你会看到这样的界面：</p>
            <Screenshot
              src="/guide/macos/step-02.png"
              alt="MacOS 终端打开界面"
              caption="终端已打开，准备输入命令"
            />
          </section>

          {/* Step 2: 安装 Homebrew */}
          <section>
            <h2 className="text-xl font-semibold text-orange-700 mb-3 flex items-center gap-2">
              <StepNumber n={2} />
              安装 Homebrew
            </h2>
            <p className="mb-2">
              <a href="https://brew.sh" target="_blank" rel="noopener noreferrer" className="text-orange-600 hover:underline font-medium">Homebrew</a> 是 MacOS 上最常用的包管理器，后续安装 Node.js 需要用到它。
            </p>
            <p className="mb-3">
              下载 Homebrew 安装包（<code className="bg-slate-100 px-1.5 py-0.5 rounded text-sm">.pkg</code> 格式），双击安装即可：
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm">
              <p className="text-blue-800 font-medium mb-2">📦 下载方式：</p>
              <p className="text-blue-700">访问 <a href="https://github.com/Homebrew/brew/releases" target="_blank" rel="noopener noreferrer" className="text-orange-600 hover:underline">Homebrew GitHub Releases</a> 页面，下载最新的 <code className="bg-blue-100 px-1 rounded">.pkg</code> 安装包，双击安装到电脑。</p>
            </div>
            <Tip>
              如果你已经安装了 Homebrew，可以跳过此步。在终端输入 <code className="bg-amber-100 px-1 rounded">brew --version</code> 检查。
            </Tip>
          </section>

          {/* Step 3: 安装 Node.js */}
          <section>
            <h2 className="text-xl font-semibold text-orange-700 mb-3 flex items-center gap-2">
              <StepNumber n={3} />
              安装 / 升级 Node.js 到 v22+
            </h2>
            <p className="mb-3">OpenClaw 需要 Node.js v22 以上版本。先检查你当前的版本：</p>
            <CodeBlock>node --version</CodeBlock>
            <p className="text-sm text-slate-500 mb-3">如果输出 <code className="bg-slate-100 px-1 rounded">v22.x.x</code> 或更高，可以跳过此步。</p>

            <p className="mb-2">用 Homebrew 安装 Node.js v22：</p>
            <CodeBlock>{`brew install node@22`}</CodeBlock>

            <p className="mb-2">添加到环境变量，让终端能找到它：</p>
            <CodeBlock>{`echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc

# 立即生效
source ~/.zshrc`}</CodeBlock>

            <p className="mb-2">验证安装：</p>
            <CodeBlock>node --version</CodeBlock>
            <div className="text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm">
              ✅ 看到 <code>v22.x.x</code> 或更高版本号，说明安装成功。
            </div>
          </section>

          {/* Step 4: 安装 OpenClaw */}
          <section>
            <h2 className="text-xl font-semibold text-orange-700 mb-3 flex items-center gap-2">
              <StepNumber n={4} />
              安装 OpenClaw
            </h2>
            <p className="mb-3">在终端输入以下命令，一键安装 OpenClaw：</p>
            <CodeBlock>curl -fsSL https://openclaw.ai/install.sh | bash</CodeBlock>
            <p className="mb-3">安装过程会自动下载并配置，等待安装完成：</p>
            <Screenshot
              src="/guide/macos/step-03.png"
              alt="OpenClaw 安装过程"
              caption="安装脚本正在运行..."
            />
            <Screenshot
              src="/guide/macos/step-04.png"
              alt="OpenClaw 安装继续"
              caption="安装过程中会出现配置提示"
            />
          </section>

          {/* Step 5: 配置网关 */}
          <section>
            <h2 className="text-xl font-semibold text-orange-700 mb-3 flex items-center gap-2">
              <StepNumber n={5} />
              配置网关
            </h2>
            <p className="mb-3">
              安装完成后，会提示 <strong>「现在将网关服务配置更新为推荐的默认值吗?」</strong>
            </p>
            <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-800 mb-3">
              ✅ 选择 <strong>Yes</strong>，使用推荐的默认配置。
            </div>
            <Screenshot
              src="/guide/macos/step-05.png"
              alt="网关配置界面"
              caption="网关配置详情"
            />
            <p className="mt-3">
              配置完成后会提示 <strong>「现在重启网关服务吗?」</strong>，同样选择 <strong>Yes</strong>。
            </p>
          </section>

          {/* Step 6: 选择模型 */}
          <section>
            <h2 className="text-xl font-semibold text-orange-700 mb-3 flex items-center gap-2">
              <StepNumber n={6} />
              选择 AI 模型
            </h2>
            <p className="mb-3">
              进入模型选择界面，可以看到支持的所有模型供应商列表：
            </p>
            <Screenshot
              src="/guide/macos/step-06.png"
              alt="模型选择列表"
              caption="Model/auth provider 选择界面"
            />
            <p className="mt-3 mb-2">选择你想要使用的模型。<strong>国内推荐：</strong></p>
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-orange-500 mt-0.5">●</span>
                  <span><strong>Moonshot AI (Kimi K2.5)</strong> — 国内可用，注册即用，效果不错</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-slate-400 mt-0.5">○</span>
                  <span><strong>DeepSeek</strong> — 国内开源模型，性价比高</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-slate-400 mt-0.5">○</span>
                  <span><strong>Qwen（通义千问）</strong> — 阿里云，国内大厂</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-slate-400 mt-0.5">○</span>
                  <span><strong>BytePlus / Volcano Engine</strong> — 字节跳动旗下</span>
                </li>
              </ul>
              <Warning>
                使用 <strong>Anthropic / OpenAI</strong> 需要全局代理（VPN），在中国大陆无法直连。
              </Warning>
            </div>
          </section>

          {/* Step 7: 填入 API Key */}
          <section>
            <h2 className="text-xl font-semibold text-orange-700 mb-3 flex items-center gap-2">
              <StepNumber n={7} />
              填入 API Key
            </h2>
            <p className="mb-3">
              选择模型后，需要输入对应的 API Key。以 <strong>Kimi (Moonshot AI)</strong> 为例：
            </p>
            <ol className="list-decimal list-inside space-y-2 ml-2 text-sm mb-3">
              <li>去 <a href="https://platform.moonshot.cn" target="_blank" rel="noopener noreferrer" className="text-orange-600 hover:underline">Kimi 开放平台</a> 注册账号</li>
              <li>在后台创建一个新的 API Key</li>
              <li>复制 API Key，粘贴到终端提示处</li>
            </ol>
            <Screenshot
              src="/guide/macos/step-07.png"
              alt="输入 API Key"
              caption="选择 Moonshot AI，输入 API Key"
            />
          </section>

          {/* Step 8: 配置使用环境 */}
          <section>
            <h2 className="text-xl font-semibold text-orange-700 mb-3 flex items-center gap-2">
              <StepNumber n={8} />
              配置使用环境
            </h2>
            <p className="mb-3">
              接下来选择使用环境（Select channel）。如果你只需要在网页端使用：
            </p>
            <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-800 mb-3">
              ✅ 选择 <strong>Skip for now</strong>（稍后配置），我们后面会直接用 Web UI。
            </div>
            <Screenshot
              src="/guide/macos/step-08.png"
              alt="使用环境选择"
              caption="Select channel 界面"
            />
          </section>

          {/* Step 9: 技能和钩子 */}
          <section>
            <h2 className="text-xl font-semibold text-orange-700 mb-3 flex items-center gap-2">
              <StepNumber n={9} />
              配置技能（Skills）和钩子（Hooks）
            </h2>
            <p className="mb-3">
              Skills 是 Agent 的扩展能力，Hooks 是自动化触发器。<strong>初次安装建议都跳过：</strong>
            </p>
            <ul className="list-disc list-inside space-y-1 ml-2 text-sm mb-3">
              <li>Configure skills? → 选择 <strong>No</strong></li>
              <li>Enable hooks? → 选择 <strong>Skip for now</strong></li>
            </ul>
            <Screenshot
              src="/guide/macos/step-09.png"
              alt="技能和钩子配置"
              caption="初次安装建议跳过技能和钩子配置"
            />
            <Tip>
              之后想添加技能或钩子时，随时执行 <code className="bg-amber-100 px-1 rounded">openclaw configure</code> 重新进入配置即可。
            </Tip>
          </section>

          {/* Step 10: 重启网关 */}
          <section>
            <h2 className="text-xl font-semibold text-orange-700 mb-3 flex items-center gap-2">
              <StepNumber n={10} />
              重启网关服务
            </h2>
            <p className="mb-3">
              提示 <strong>「Gateway service already installed」</strong>，你会看到三个选项：
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm space-y-1 font-mono mb-3">
              <div className="text-orange-600">● Restart <span className="text-slate-500 font-sans">← 选这个</span></div>
              <div className="text-slate-400">○ Reinstall</div>
              <div className="text-slate-400">○ Skip</div>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-800">
              ✅ 选择 <strong>Restart</strong>，重启已安装的网关服务。
            </div>
          </section>

          {/* Step 11: 入门模式 */}
          <section>
            <h2 className="text-xl font-semibold text-orange-700 mb-3 flex items-center gap-2">
              <StepNumber n={11} />
              选择入门模式
            </h2>
            <Screenshot
              src="/guide/macos/step-10.png"
              alt="入门模式选择"
              caption="Onboarding mode 选择界面"
            />
            <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-800 mt-3">
              ✅ 选择 <strong>QuickStart</strong>（快速启动），之后随时可以通过 <code className="bg-green-100 px-1 rounded">openclaw configure</code> 调整配置。
            </div>
          </section>

          {/* Step 12: 配置处理 */}
          <section>
            <h2 className="text-xl font-semibold text-orange-700 mb-3 flex items-center gap-2">
              <StepNumber n={12} />
              配置处理
            </h2>
            <Screenshot
              src="/guide/macos/step-11.png"
              alt="配置处理选择"
              caption="Config handling 选择界面"
            />
            <p className="mt-3 mb-2">三个选项：</p>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm space-y-2 mb-3">
              <div><strong>Use existing values</strong> — 使用现有配置（如果之前已配置过）</div>
              <div><strong>Update values</strong> — 更新部分配置</div>
              <div><strong>Reset</strong> — 重新配置</div>
            </div>
            <p className="text-sm">首次安装选择 <strong>Reset</strong> 重新配置即可。</p>
          </section>

          {/* Step 12b: 重置范围 */}
          <section>
            <h2 className="text-xl font-semibold text-orange-700 mb-3 flex items-center gap-2">
              <StepNumber n={12} />
              <span className="text-base text-slate-500 font-normal">续</span>
              选择重置范围
            </h2>
            <Screenshot
              src="/guide/macos/step-12.png"
              alt="重置范围选择"
              caption="Reset scope 选择界面"
            />
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm space-y-2 mb-3">
              <div><strong>Config only</strong> — 仅重置配置（推荐）</div>
              <div><strong>Config + creds + sessions</strong> — 配置 + 凭据 + 会话</div>
              <div><strong>Full reset</strong> — 完全重置（配置 + 凭证 + 会话 + 工作区）</div>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-800">
              ✅ 如果 API 没有问题，直接选择 <strong>Config only</strong>。
            </div>
          </section>

          {/* Step 13: 打开 Web UI */}
          <section>
            <h2 className="text-xl font-semibold text-orange-700 mb-3 flex items-center gap-2">
              <StepNumber n={13} />
              打开 Web UI 开始使用！
            </h2>
            <p className="mb-3">
              最后一步，选择打开方式：
            </p>
            <Screenshot
              src="/guide/macos/step-13.png"
              alt="对话页面打开方式"
              caption="How do you want to hatch your bot?"
            />
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm space-y-2 mb-3">
              <div><strong>Hatch in TUI</strong> — 在终端中启动（推荐给开发者）</div>
              <div className="text-orange-700 font-medium"><strong>Open the Web UI</strong> — 在网页中打开 ← 推荐</div>
              <div><strong>Do this later</strong> — 稍后操作</div>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-800">
              ✅ 选择 <strong>Open the Web UI</strong>，浏览器会自动打开 OpenClaw 控制界面。
            </div>

            <div className="mt-6 bg-gradient-to-r from-orange-500 to-rose-500 rounded-2xl p-5 text-white">
              <h3 className="font-bold text-lg mb-2">🎉 恭喜！安装完成！</h3>
              <p className="text-orange-100 text-sm">
                你的 OpenClaw 已经配置好了。现在可以在 Web UI 中和你的 Agent 对话，让它帮你完成各种任务！
              </p>
            </div>
          </section>

          {/* 常见问题 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-800 mb-4">❓ 常见问题</h2>
            <div className="space-y-4">
              {[
                {
                  q: '终端提示 command not found: brew',
                  a: 'Homebrew 没有安装成功。请重新按照第 2 步安装 Homebrew。'
                },
                {
                  q: 'node --version 显示版本低于 22',
                  a: '运行 brew install node@22 安装新版本，然后按第 3 步添加环境变量并执行 source ~/.zshrc。'
                },
                {
                  q: 'curl 安装脚本失败，提示网络错误',
                  a: '可能是网络问题。如果开着 VPN，尝试关掉 VPN 再运行。或者检查是否能访问 openclaw.ai。'
                },
                {
                  q: 'AI 模型无法调用，报连接错误',
                  a: '使用 Anthropic/OpenAI 需要全局代理（VPN）。建议使用 Kimi、DeepSeek 等国内可用的模型。'
                },
                {
                  q: '想重新配置怎么办？',
                  a: '随时在终端运行 openclaw configure，可以重新进入配置流程，修改模型、API Key、技能等。'
                },
              ].map((item, i) => (
                <div key={i} className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="bg-red-50 px-4 py-3 font-medium text-red-800 text-sm">❌ {item.q}</div>
                  <div className="px-4 py-3 text-sm text-slate-700">✅ <strong>解决：</strong>{item.a}</div>
                </div>
              ))}
            </div>
          </section>

          {/* 可选工具推荐 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-800 mb-4">🔧 可选：让你的 Agent 更强大</h2>
            <div className="space-y-4">
              <div className="border border-slate-200 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-2">1. 联网搜索 Skill</h3>
                <p className="text-sm text-slate-600 mb-3">让 Agent 能上网查资料：</p>
                <CodeBlock>openclaw skill install tavily-search</CodeBlock>
              </div>
              <div className="border border-slate-200 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-2">2. Chrome 扩展（Browser Relay）</h3>
                <p className="text-sm text-slate-600">让 Agent 操控浏览器、填表单、截图。在 Chrome 应用商店搜索「<strong>OpenClaw Browser Relay</strong>」安装。</p>
              </div>
              <div className="border border-slate-200 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-2">3. ClawHub —— 技能商店</h3>
                <p className="text-sm text-slate-600 mb-3">发现并安装更多技能：</p>
                <CodeBlock>{`openclaw skill search <关键词>`}</CodeBlock>
                <p className="text-sm text-slate-500">或直接访问 <a href="https://clawhub.com" target="_blank" rel="noopener noreferrer" className="text-orange-600 hover:underline">clawhub.com</a> 浏览。</p>
              </div>
            </div>
          </section>

        </div>
      </main>

      {/* 底部 */}
      <footer className="border-t border-slate-100 mt-16">
        <div className="max-w-3xl mx-auto px-4 py-6 text-center text-sm text-slate-400">
          <p className="mb-2">
            <Link href="/guide/china-install" className="text-orange-500 hover:underline">📖 查看 Windows 安装指南</Link>
          </p>
          <p>文档由社区贡献 · <Link href="/" className="text-orange-500 hover:underline">TeamAgent</Link></p>
        </div>
      </footer>
    </div>
  )
}
