import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: '🇨🇳 中国用户安装指南 | OpenClaw',
  description: '专为中国大陆 Windows 用户编写的 OpenClaw 安装指南，覆盖 npm 镜像、PowerShell 执行策略、国内可用 AI 模型等常见坑。',
}

const guideContent = `# OpenClaw 中国用户安装指南（Windows 版）

> 本文专为在中国大陆使用 Windows 电脑的新手用户编写，涵盖官方文档未提及的常见坑。

---

## 第一步：安装 Node.js

OpenClaw 基于 Node.js，必须先装它。

1. 打开浏览器，访问 [https://nodejs.org](https://nodejs.org)
2. 下载 **LTS 版本**（长期支持版，更稳定）
3. 双击安装包，一路「下一步」即可
4. 安装完成后，打开 **命令提示符**（按 \`Win+R\`，输入 \`cmd\`，回车）
5. 输入以下命令验证安装：

\`\`\`
node --version
npm --version
\`\`\`

✅ 看到版本号（如 \`v22.x.x\`）说明安装成功。

---

## 第二步：解决 PowerShell 执行策略问题

> ⚠️ 如果你打开 PowerShell 后运行命令显示「**此系统上禁止运行脚本**」，按以下步骤修复。

1. 右键点击开始菜单 → 选择「**Windows PowerShell (管理员)**」
2. 输入以下命令并回车：

\`\`\`powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
\`\`\`

3. 提示确认时输入 \`Y\` 回车
4. 关闭 PowerShell，重新打开，问题解决

---

## 第三步：配置 npm 国内镜像（必须）

> ⚠️ 中国大陆访问 npm 官方源很慢，甚至超时失败。**强烈建议先换源。**

在命令提示符中运行：

\`\`\`
npm config set registry https://registry.npmmirror.com
\`\`\`

验证是否生效：

\`\`\`
npm config get registry
\`\`\`

看到 \`https://registry.npmmirror.com\` 说明成功。

---

## 第四步：安装 OpenClaw

\`\`\`
npm install -g openclaw
\`\`\`

安装完成后验证：

\`\`\`
openclaw --version
\`\`\`

---

## 第五步：配置 AI API Key

OpenClaw 需要 AI 模型才能工作。推荐以下两种方案：

### 方案 A：使用 Anthropic（Claude）
> ⚠️ Anthropic 在中国大陆无法直连，**需要全局代理（VPN）**。

\`\`\`
openclaw auth add anthropic
\`\`\`

按提示输入你的 API Key（从 [console.anthropic.com](https://console.anthropic.com) 获取）。

### 方案 B：使用国内可用的模型（推荐中国用户）
OpenClaw 支持兼容 OpenAI 格式的模型，可用国内服务如：
- **阿里云百炼**（通义千问）
- **DeepSeek**
- **月之暗面（Kimi）**

\`\`\`
openclaw auth add openai --base-url https://api.deepseek.com --key sk-你的key
\`\`\`

---

## 第六步：启动网关

\`\`\`
openclaw gateway
\`\`\`

看到类似以下输出说明启动成功：

\`\`\`
🦞 OpenClaw 2026.x.x
[gateway] listening on ws://127.0.0.1:18789
\`\`\`

**保持这个窗口开着，不要关闭。**

---

## 第七步：打开控制界面并连接

### 先获取你的 Gateway Token

运行以下命令：
\`\`\`
openclaw gateway status
\`\`\`

复制输出中 \`token=\` 后面的那串值。

或直接查看配置文件（用记事本打开，找 \`"token"\` 字段）：
\`\`\`
C:\\Users\\你的用户名\\.openclaw\\openclaw.json
\`\`\`

### 带 Token 直接访问控制界面

把下面 URL 中的 \`你的Token\` 替换为上面复制的值，粘贴到浏览器地址栏：

**http://127.0.0.1:18789/?token=你的Token**

这样免去手动填写 Token 的步骤，直接进入 OpenClaw 控制界面 ✅

---

## 常见问题

### ❌ 问题：\`token_missing\`，一直连接不上
**原因：** 访问 URL 时没有带上 Gateway Token。
**解决：** 按第七步获取 Token，然后用带参数的格式访问：\`http://127.0.0.1:18789/?token=你的Token\`

---

### ❌ 问题：\`npm install -g openclaw\` 失败，提示网络错误
**原因：** npm 镜像没有配置，或 VPN 干扰了国内镜像。
**解决：**
1. 先确认已换国内镜像（第三步）
2. 如果开着 VPN，**关掉 VPN** 再安装
3. 再次运行安装命令

---

### ❌ 问题：PowerShell 显示「此系统上禁止运行脚本」
**解决：** 参考第二步，修改执行策略。

---

### ❌ 问题：AI 模型无法调用，报连接错误
**原因（使用 Anthropic）：** Anthropic 在中国大陆被屏蔽。
**解决：**
- 开启全局代理（VPN），确保能访问 \`api.anthropic.com\`
- 或者换用国内可用的模型（见第五步方案 B）

---

## 安装全流程速查

\`\`\`
1. 安装 Node.js
2. 修复 PowerShell 执行策略（如果需要）
3. 换 npm 国内镜像
4. npm install -g openclaw
5. openclaw auth add（配置 AI Key）
6. openclaw gateway（启动网关）
7. 浏览器打开 http://127.0.0.1:18789/?token=你的Token 直接连接
\`\`\`

---

## 🔧 可选工具推荐（让你的 Agent 更强大）

### 1. 联网搜索 Skill
\`\`\`
openclaw skill install tavily-search
\`\`\`
安装后 Agent 可以搜索网页、查文档、找最新资讯。

### 2. Chrome 扩展（Browser Relay）
让 Agent 操控浏览器、填表单、截图、自动化网页操作。
Chrome 应用商店搜索「OpenClaw Browser Relay」，或访问 https://openclaw.ai/chrome-extension

### 3. ClawHub —— 发现更多 Skill
\`\`\`
openclaw skill search <关键词>
\`\`\`
或访问 https://clawhub.com 浏览所有可用 Skill。

### 4. Moltbook —— OpenClaw Agent 社区
访问 https://moltbook.com，认领你的 Agent 身份，有了公开主页就能和其他人协作。

> 💡 核心理念：安装完基础环境后，让 Agent 自己去 ClawHub 找它需要的 skill——你只需告诉它要做什么，它会学会怎么做。

---

> 文档由 **八爪** 🐙 根据真实安装踩坑经验整理
> 如有问题欢迎加入 OpenClaw 社区：[discord.com/invite/clawd](https://discord.com/invite/clawd)
`

export default function ChinaInstallGuidePage() {
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
            href="/guide/macos-install"
            className="text-sm text-orange-500 hover:text-orange-600 transition-colors font-medium"
          >
            MacOS 版 →
          </Link>
        </div>
      </header>

      {/* 横幅 */}
      <div className="bg-gradient-to-r from-red-500 to-orange-500 text-white">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <span className="text-2xl">🇨🇳</span>
          <div>
            <div className="font-bold text-lg">中国用户安装指南</div>
            <div className="text-sm text-red-100">Windows 版 · 覆盖国内常见坑 · 由 八爪🐙 根据实战经验整理</div>
            <div className="flex gap-2 mt-3">
              <span className="px-3 py-1 bg-white/25 rounded-full text-sm font-medium backdrop-blur-sm border border-white/20">
                🪟 Windows（当前）
              </span>
              <Link
                href="/guide/macos-install"
                className="px-3 py-1 bg-white/10 rounded-full text-sm hover:bg-white/20 transition-colors border border-white/10"
              >
                🍎 MacOS 版
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* 正文 */}
      <main className="max-w-3xl mx-auto px-4 py-8">
        <article className="prose prose-slate prose-lg max-w-none
          prose-headings:text-slate-800 
          prose-h1:text-2xl prose-h1:font-bold prose-h1:mb-6
          prose-h2:text-xl prose-h2:font-semibold prose-h2:mt-10 prose-h2:mb-4 prose-h2:text-orange-700
          prose-h3:text-lg prose-h3:font-medium prose-h3:mt-6 prose-h3:mb-3
          prose-p:text-slate-700 prose-p:leading-relaxed
          prose-strong:text-slate-900
          prose-code:bg-orange-50 prose-code:text-orange-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm
          prose-pre:bg-slate-900 prose-pre:text-slate-100 prose-pre:rounded-xl
          prose-a:text-orange-600 prose-a:no-underline hover:prose-a:underline
          prose-blockquote:border-l-orange-400 prose-blockquote:bg-orange-50/50 prose-blockquote:rounded-r-lg prose-blockquote:py-1
          prose-hr:border-slate-200
          prose-li:text-slate-700
          prose-ol:marker:text-orange-500 prose-ul:marker:text-orange-400">
          {guideContent.split('\n').map((line, i) => {
            // 代码块
            if (line.startsWith('```')) return null
            // H1
            if (line.startsWith('# ')) return <h1 key={i}>{line.slice(2)}</h1>
            // H2
            if (line.startsWith('## ')) return <h2 key={i}>{line.slice(3)}</h2>
            // H3
            if (line.startsWith('### ')) return <h3 key={i}>{line.slice(4)}</h3>
            // HR
            if (line.trim() === '---') return <hr key={i} />
            return null
          })}
        </article>

        {/* 用 dangerouslySetInnerHTML 方式渲染 Markdown — 改为静态硬编码 */}
        <GuideContent />
      </main>

      {/* 底部 */}
      <footer className="border-t border-slate-100 mt-16">
        <div className="max-w-3xl mx-auto px-4 py-6 text-center text-sm text-slate-400">
          <p>文档由 <strong>八爪</strong> 🐙 根据真实安装踩坑经验整理 · <Link href="/" className="text-orange-500 hover:underline">TeamAgent</Link></p>
        </div>
      </footer>
    </div>
  )
}

// 静态渲染的指南内容
function GuideContent() {
  return (
    <div className="space-y-8 text-slate-700 leading-relaxed">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        💡 <strong>提示：</strong>本指南针对 Windows 用户。如果你使用 Mac，请查看
        <Link href="/guide/macos-install" className="text-orange-600 hover:underline ml-1 font-medium">🍎 MacOS 安装指南（含截图）</Link>
      </div>

      {/* Step 1 */}
      <section>
        <h2 className="text-xl font-semibold text-orange-700 mb-3 flex items-center gap-2">
          <span className="bg-orange-100 text-orange-600 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">1</span>
          安装 Node.js
        </h2>
        <ol className="list-decimal list-inside space-y-2 ml-2">
          <li>打开浏览器，访问 <a href="https://nodejs.org" target="_blank" rel="noopener noreferrer" className="text-orange-600 hover:underline">https://nodejs.org</a></li>
          <li>下载 <strong>LTS 版本</strong>（长期支持版，更稳定）</li>
          <li>双击安装包，一路「下一步」即可</li>
          <li>安装完成后，打开 <strong>命令提示符</strong>（按 <code className="bg-slate-100 px-1 rounded text-sm">Win+R</code>，输入 <code className="bg-slate-100 px-1 rounded text-sm">cmd</code>，回车）</li>
          <li>输入以下命令验证：</li>
        </ol>
        <pre className="bg-slate-900 text-green-300 rounded-xl p-4 mt-3 text-sm overflow-x-auto"><code>{`node --version\nnpm --version`}</code></pre>
        <p className="mt-2 text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm">✅ 看到版本号（如 <code>v22.x.x</code>）说明安装成功。</p>
      </section>

      {/* Step 2 */}
      <section>
        <h2 className="text-xl font-semibold text-orange-700 mb-3 flex items-center gap-2">
          <span className="bg-orange-100 text-orange-600 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">2</span>
          解决 PowerShell 执行策略问题
        </h2>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800 mb-3">
          ⚠️ 如果运行命令显示「<strong>此系统上禁止运行脚本</strong>」，按以下步骤修复。
        </div>
        <ol className="list-decimal list-inside space-y-2 ml-2">
          <li>右键点击开始菜单 → 选择「<strong>Windows PowerShell (管理员)</strong>」</li>
          <li>输入以下命令并回车：</li>
        </ol>
        <pre className="bg-slate-900 text-blue-300 rounded-xl p-4 mt-3 text-sm overflow-x-auto"><code>Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser</code></pre>
        <ol className="list-decimal list-inside space-y-2 ml-2 mt-3" start={3}>
          <li>提示确认时输入 <code className="bg-slate-100 px-1 rounded text-sm">Y</code> 回车</li>
          <li>关闭 PowerShell，重新打开，问题解决</li>
        </ol>
      </section>

      {/* Step 3 */}
      <section>
        <h2 className="text-xl font-semibold text-orange-700 mb-3 flex items-center gap-2">
          <span className="bg-orange-100 text-orange-600 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">3</span>
          配置 npm 国内镜像（必须）
        </h2>
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800 mb-3">
          ⚠️ 中国大陆访问 npm 官方源很慢，甚至超时失败。<strong>强烈建议先换源。</strong>
        </div>
        <pre className="bg-slate-900 text-green-300 rounded-xl p-4 text-sm overflow-x-auto"><code>{`npm config set registry https://registry.npmmirror.com\nnpm config get registry`}</code></pre>
        <p className="mt-2 text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm">✅ 看到 <code>https://registry.npmmirror.com</code> 说明成功。</p>
      </section>

      {/* Step 4 */}
      <section>
        <h2 className="text-xl font-semibold text-orange-700 mb-3 flex items-center gap-2">
          <span className="bg-orange-100 text-orange-600 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">4</span>
          安装 OpenClaw
        </h2>
        <pre className="bg-slate-900 text-green-300 rounded-xl p-4 text-sm overflow-x-auto"><code>{`npm install -g openclaw\nopenclaw --version`}</code></pre>
      </section>

      {/* Step 5 */}
      <section>
        <h2 className="text-xl font-semibold text-orange-700 mb-3 flex items-center gap-2">
          <span className="bg-orange-100 text-orange-600 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">5</span>
          配置 AI API Key
        </h2>
        <div className="space-y-4">
          <div className="border border-slate-200 rounded-xl p-4">
            <h3 className="font-semibold text-slate-800 mb-2">方案 A：使用 Anthropic（Claude）</h3>
            <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-sm text-yellow-800 mb-3">
              ⚠️ Anthropic 在中国大陆无法直连，<strong>需要全局代理（VPN）</strong>。
            </div>
            <pre className="bg-slate-900 text-green-300 rounded-xl p-3 text-sm"><code>openclaw auth add anthropic</code></pre>
          </div>
          <div className="border border-orange-200 bg-orange-50/50 rounded-xl p-4">
            <h3 className="font-semibold text-orange-800 mb-2">🌟 方案 B：使用国内可用的模型（推荐中国用户）</h3>
            <p className="text-sm text-slate-600 mb-3">支持兼容 OpenAI 格式的模型：<strong>阿里云百炼</strong>、<strong>DeepSeek</strong>、<strong>月之暗面（Kimi）</strong></p>
            <pre className="bg-slate-900 text-green-300 rounded-xl p-3 text-sm overflow-x-auto"><code>openclaw auth add openai --base-url https://api.deepseek.com --key sk-你的key</code></pre>
          </div>
        </div>
      </section>

      {/* Step 6 */}
      <section>
        <h2 className="text-xl font-semibold text-orange-700 mb-3 flex items-center gap-2">
          <span className="bg-orange-100 text-orange-600 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">6</span>
          启动网关
        </h2>
        <pre className="bg-slate-900 text-green-300 rounded-xl p-4 text-sm overflow-x-auto"><code>{`openclaw gateway\n\n# 看到以下输出说明成功：\n🦞 OpenClaw 2026.x.x\n[gateway] listening on ws://127.0.0.1:18789`}</code></pre>
        <p className="mt-2 text-slate-600 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">💡 <strong>保持这个窗口开着，不要关闭。</strong></p>
      </section>

      {/* Step 7 */}
      <section>
        <h2 className="text-xl font-semibold text-orange-700 mb-3 flex items-center gap-2">
          <span className="bg-orange-100 text-orange-600 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">7</span>
          打开控制界面并连接
        </h2>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4">
          <h3 className="font-semibold text-slate-800 mb-3">第一步：先获取你的 Gateway Token</h3>
          <p className="text-sm text-slate-600 mb-2">运行以下命令，复制输出中 <code className="bg-slate-200 px-1 rounded">token=</code> 后面的值：</p>
          <pre className="bg-slate-900 text-green-300 rounded-xl p-3 text-sm"><code>openclaw gateway status</code></pre>
          <p className="text-sm text-slate-600 mt-3 mb-2">或直接查看配置文件（用记事本打开，找 <code className="bg-slate-200 px-1 rounded">&quot;token&quot;</code> 字段）：</p>
          <pre className="bg-slate-900 text-slate-300 rounded-xl p-3 text-sm"><code>C:\Users\你的用户名\.openclaw\openclaw.json</code></pre>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
          <h3 className="font-semibold text-orange-800 mb-2">第二步：带 Token 直接访问控制界面</h3>
          <p className="text-sm text-slate-600 mb-2">把下面 URL 中的 <code className="bg-slate-200 px-1 rounded">你的Token</code> 替换为上面复制的值，粘贴到浏览器地址栏：</p>
          <pre className="bg-slate-900 text-green-300 rounded-xl p-3 text-sm"><code>http://127.0.0.1:18789/?token=你的Token</code></pre>
          <p className="text-sm text-orange-700 mt-2">✅ 免去手动填写 Token 的步骤，直接进入 OpenClaw 控制界面。</p>
        </div>
      </section>

      {/* 常见问题 */}
      <section>
        <h2 className="text-xl font-semibold text-slate-800 mb-4">❓ 常见问题</h2>
        <div className="space-y-4">
          {[
            {
              q: 'token_missing，一直连接不上',
              a: '没有在 URL 里带上 Token。按第七步获取 Token，然后用 http://127.0.0.1:18789/?token=你的Token 的格式访问。'
            },
            {
              q: 'npm install -g openclaw 失败，提示网络错误',
              a: '先确认已换国内镜像（第三步）。如果开着 VPN，关掉 VPN 再安装。'
            },
            {
              q: 'PowerShell 显示「此系统上禁止运行脚本」',
              a: '参考第二步，修改执行策略。'
            },
            {
              q: 'AI 模型无法调用，报连接错误',
              a: '使用 Anthropic 时需要全局代理（VPN）。建议换用国内可用的模型（见第五步方案 B）。'
            },
          ].map((item, i) => (
            <div key={i} className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="bg-red-50 px-4 py-3 font-medium text-red-800 text-sm">❌ 问题：{item.q}</div>
              <div className="px-4 py-3 text-sm text-slate-700">✅ <strong>解决：</strong>{item.a}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 可选工具推荐 */}
      <section>
        <h2 className="text-xl font-semibold text-slate-800 mb-4">🔧 可选工具推荐（让你的 Agent 更强大）</h2>
        <div className="space-y-4">

          <div className="border border-slate-200 rounded-xl p-4">
            <h3 className="font-semibold text-slate-800 mb-2">1. 联网搜索 Skill</h3>
            <p className="text-sm text-slate-600 mb-3">Agent 默认不能上网，安装搜索 skill 后可以实时查资料：</p>
            <pre className="bg-slate-900 text-green-300 rounded-xl p-3 text-sm mb-2"><code>openclaw skill install tavily-search</code></pre>
            <p className="text-sm text-slate-500">安装后 Agent 可以搜索网页、查文档、找最新资讯。</p>
          </div>

          <div className="border border-slate-200 rounded-xl p-4">
            <h3 className="font-semibold text-slate-800 mb-2">2. Chrome 扩展（Browser Relay）</h3>
            <p className="text-sm text-slate-600 mb-2">让 Agent 帮你操控浏览器，填表单、截图、自动化网页操作：</p>
            <ul className="text-sm text-slate-600 space-y-1 list-disc list-inside">
              <li>Chrome 应用商店搜索「<strong>OpenClaw Browser Relay</strong>」安装</li>
              <li>或访问：<code className="bg-slate-100 px-1 rounded">https://openclaw.ai/chrome-extension</code></li>
              <li>安装后点工具栏图标，把当前标签页「移交」给 Agent</li>
            </ul>
          </div>

          <div className="border border-slate-200 rounded-xl p-4">
            <h3 className="font-semibold text-slate-800 mb-2">3. ClawHub —— 发现更多 Skill</h3>
            <p className="text-sm text-slate-600 mb-3">Agent 技能商店，你的 Agent 可以自己去找并安装新技能：</p>
            <pre className="bg-slate-900 text-green-300 rounded-xl p-3 text-sm mb-2"><code>{`openclaw skill search <关键词>`}</code></pre>
            <p className="text-sm text-slate-500">或直接访问 <code className="bg-slate-100 px-1 rounded">https://clawhub.com</code> 浏览所有可用 Skill。</p>
          </div>

          <div className="border border-slate-200 rounded-xl p-4">
            <h3 className="font-semibold text-slate-800 mb-2">4. Moltbook —— OpenClaw Agent 社区</h3>
            <p className="text-sm text-slate-600 mb-2">Agent 的社交主页，在这里认领你的 Agent 身份、展示能力、加入社区：</p>
            <ul className="text-sm text-slate-600 space-y-1 list-disc list-inside">
              <li>访问：<code className="bg-slate-100 px-1 rounded">https://moltbook.com</code></li>
              <li>用你的账号登录后，认领对应的 Agent</li>
              <li>认领后 Agent 有了公开身份，可以被其他人找到和协作</li>
            </ul>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-sm text-blue-800">💡 <strong>核心理念：</strong>安装完基础环境后，让 Agent 自己去 ClawHub 找它需要的 skill——你只需告诉它要做什么，它会学会怎么做。</p>
          </div>

        </div>
      </section>

      {/* 速查 */}
      <section className="bg-gradient-to-br from-orange-50 to-red-50 border border-orange-200 rounded-2xl p-6">
        <h2 className="text-xl font-semibold text-orange-800 mb-4">🗺️ 安装全流程速查</h2>
        <div className="space-y-2">
          {[
            '安装 Node.js',
            '修复 PowerShell 执行策略（如果需要）',
            '换 npm 国内镜像',
            'npm install -g openclaw',
            'openclaw auth add（配置 AI Key）',
            'openclaw gateway（启动网关）',
            '浏览器打开 http://127.0.0.1:18789/?token=你的Token 直接连接',
          ].map((step, i) => (
            <div key={i} className="flex items-center gap-3 text-slate-700">
              <span className="bg-orange-500 text-white w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                {i + 1}
              </span>
              <span className="text-sm">{step}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
