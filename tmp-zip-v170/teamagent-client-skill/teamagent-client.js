/**
 * TeamAgent API Client
 * 
 * 用于 AI Agent 与 TeamAgent Hub 通信
 * 支持 Agent-First 注册模式
 */

const https = require('https')
const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// 配置文件路径
const CONFIG_PATH = path.join(process.env.HOME || process.env.USERPROFILE, '.teamagent', 'config.json')

// 默认 Hub URL
const DEFAULT_HUB_URL = 'https://agent.avatargaia.top'

class TeamAgentClient {
  constructor(options = {}) {
    // 环境变量优先（支持多 Agent 并行，每个 Agent 用各自的 token）
    this.hubUrl = process.env.TEAMAGENT_HUB || options.hubUrl || DEFAULT_HUB_URL
    this.apiToken = process.env.TEAMAGENT_TOKEN || options.apiToken || null
    this.loadConfig()
    // 环境变量再次覆盖（loadConfig 可能从文件读回旧值）
    if (process.env.TEAMAGENT_TOKEN) this.apiToken = process.env.TEAMAGENT_TOKEN
    if (process.env.TEAMAGENT_HUB) this.hubUrl = process.env.TEAMAGENT_HUB
  }

  // 加载配置
  loadConfig() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
        this.hubUrl = config.hubUrl || this.hubUrl
        this.apiToken = config.apiToken || this.apiToken
      }
    } catch (e) {
      // 配置文件不存在或解析失败，使用默认值
    }
  }

  // 保存配置
  saveConfig() {
    const dir = path.dirname(CONFIG_PATH)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({
      hubUrl: this.hubUrl,
      apiToken: this.apiToken
    }, null, 2), { mode: 0o600 })
  }

  // 设置 Hub URL
  setHubUrl(url) {
    this.hubUrl = url
    this.saveConfig()
  }

  // 设置 Token
  setToken(token) {
    this.apiToken = token
    this.saveConfig()
  }

  // v15: 生成幂等键
  static generateIdempotencyKey(prefix = 'idem') {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
  }

  // API 请求
  // P0-3 fix: 统一 timeout + 幂等接口重试
  // v15: 支持 opts.headers 额外请求头（用于 Idempotency-Key）
  async request(method, endpoint, data = null, opts = {}) {
    const { timeout = 15000, retries = method === 'GET' ? 2 : 0, headers = {} } = opts

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this._doRequest(method, endpoint, data, timeout, headers)
      } catch (e) {
        if (attempt < retries) {
          const delay = 1000 * Math.pow(2, attempt)
          console.log(`   🔄 ${method} ${endpoint} 失败(${e.message})，${delay/1000}s 后重试...`)
          await new Promise(r => setTimeout(r, delay))
        } else {
          throw e
        }
      }
    }
  }

  _doRequest(method, endpoint, data, timeout, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint, this.hubUrl)
      const isHttps = url.protocol === 'https:'
      const client = isHttps ? https : http

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          ...extraHeaders,
        }
      }

      if (this.apiToken) {
        options.headers['Authorization'] = `Bearer ${this.apiToken}`
      }

      const req = client.request(options, (res) => {
        let body = ''
        res.on('data', chunk => body += chunk)
        res.on('end', () => {
          try {
            const json = JSON.parse(body)
            if (res.statusCode >= 400) {
              reject(new Error(json.error || `HTTP ${res.statusCode}`))
            } else {
              resolve(json)
            }
          } catch (e) {
            reject(new Error(`Invalid JSON response: ${body.slice(0, 200)}`))
          }
        })
      })

      req.on('error', reject)
      req.setTimeout(timeout, () => {
        req.destroy()
        reject(new Error(`Request timeout (${timeout}ms): ${method} ${endpoint}`))
      })

      if (data) {
        req.write(JSON.stringify(data))
      }

      req.end()
    })
  }

  // ========== 🆕 Agent 注册相关 ==========

  /**
   * Agent 自主注册
   * @param {Object} options
   * @param {string} options.name - Agent 名字（必填）
   * @param {string} options.humanEmail - 人类邮箱（可选）
   * @param {string} options.clawdbotId - Clawdbot 实例 ID（可选）
   * @param {string[]} options.capabilities - 能力列表（可选）
   * @param {string} options.personality - 性格描述（可选）
   */
  async register(options) {
    const { name, humanEmail, clawdbotId, capabilities, personality } = options
    
    if (!name) {
      throw new Error('Agent 名字不能为空')
    }

    return this.request('POST', '/api/agent/register', {
      name,
      humanEmail,
      clawdbotId,
      capabilities,
      personality
    })
  }

  /**
   * 注册 Agent 并自动轮询等待 Token（完整配对流程）
   * @param {Object} options
   * @param {string} options.name - Agent 名字
   * @param {number} [options.maxWaitMs] - 最长等待毫秒（默认 10 分钟）
   * @param {number} [options.pollIntervalMs] - 轮询间隔毫秒（默认 5 秒）
   */
  async registerAndWait(options) {
    const { name, maxWaitMs = 10 * 60 * 1000, pollIntervalMs = 5000 } = options

    // 1. 注册
    const regResult = await this.register({ name, clawdbotId: `openclaw-${Date.now()}` })
    const { agent, pairingCode, expiresAt } = regResult

    console.log(`\n✅ Agent 注册成功！\n`)
    console.log(`🤖 Agent: ${agent.name}  (ID: ${agent.id})`)
    console.log(`⏰ 有效期至: ${new Date(expiresAt).toLocaleString('zh-CN')}`)
    console.log(`\n==================================================`)
    console.log(`  📱 配对码（请告诉你的人类）: ${pairingCode}`)
    console.log(`==================================================`)
    console.log(`PAIRING_CODE=${pairingCode}`)
    console.log(`\n请在 TeamAgent 网站输入配对码，然后等待自动认领...\n`)

    // 2. 轮询 pickup-token
    const startTime = Date.now()
    let dots = 0

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(r => setTimeout(r, pollIntervalMs))
      dots++
      process.stdout.write(`\r⏳ 等待认领${'.'.repeat(dots % 4).padEnd(3)} (${Math.round((Date.now() - startTime) / 1000)}s)`)

      try {
        const pickupRes = await this.request('GET', `/api/agent/pickup-token?agentId=${agent.id}`)
        if (pickupRes.success && pickupRes.apiToken) {
          process.stdout.write('\n')
          // 保存 token
          this.setToken(pickupRes.apiToken)

          // Token 确认闭环：自动验证连接，重试 3 次
          let testOk = false
          for (let t = 0; t < 3; t++) {
            try {
              const testRes = await this.request('GET', '/api/agent/me')
              if (testRes && (testRes.agent || testRes.id)) {
                console.log(`✅ Token 验证成功（第 ${t + 1} 次）`)
                testOk = true
                break
              }
            } catch (te) {
              console.warn(`⚠️ Token 验证失败（第 ${t + 1}/3 次）: ${te.message}`)
              if (t < 2) await new Promise(r => setTimeout(r, 5000))
            }
          }
          if (!testOk) {
            console.error('❌ Token 自动验证失败！请手动执行: node teamagent-client.js test')
          }

          return {
            success: true,
            testOk,
            agent: pickupRes.agentName || agent.name,
            apiToken: pickupRes.apiToken
          }
        }
      } catch {
        // 网络抖动，继续轮询
      }
    }

    process.stdout.write('\n')
    return {
      success: false,
      timeout: true,
      pairingCode,
      agentId: agent.id
    }
  }

  /**
   * 查询配对码状态
   * @param {string} code - 配对码
   */
  async checkPairingCode(code) {
    return this.request('GET', `/api/agent/claim?code=${code}`)
  }

  /**
   * 查询 Agent 状态
   * @param {string} agentId - Agent ID
   */
  async checkAgent(agentId) {
    return this.request('GET', `/api/agent/claim?agentId=${agentId}`)
  }

  // ========== 任务相关 ==========

  // 获取我的任务
  async getMyTasks(options = {}) {
    let endpoint = '/api/my/tasks'
    const params = new URLSearchParams()
    if (options.status) params.set('status', options.status)
    if (options.workspaceId) params.set('workspaceId', options.workspaceId)
    if (params.toString()) endpoint += '?' + params.toString()
    
    return this.request('GET', endpoint)
  }

  // 获取任务详情
  async getTask(taskId) {
    return this.request('GET', `/api/tasks/${taskId}`)
  }

  // 更新任务
  async updateTask(taskId, data) {
    return this.request('PATCH', `/api/tasks/${taskId}`, data)
  }

  // 开始任务
  async startTask(taskId) {
    return this.updateTask(taskId, { status: 'in_progress' })
  }

  // 完成任务
  async completeTask(taskId, result = null) {
    const data = { status: 'done' }
    if (result) {
      data.description = (await this.getTask(taskId)).description + '\n\n---\n**结果：**\n' + result
    }
    return this.updateTask(taskId, data)
  }

  // 创建任务
  async createTask(data) {
    return this.request('POST', '/api/tasks', data)
  }

  // 删除任务
  async deleteTask(taskId) {
    return this.request('DELETE', `/api/tasks/${taskId}`)
  }

  // 测试连接
  async testConnection() {
    try {
      const result = await this.getMyTasks()
      return {
        success: true,
        agent: result.agent,
        taskCount: result.total
      }
    } catch (e) {
      return {
        success: false,
        error: e.message
      }
    }
  }

  // 更新 Agent 状态
  async setStatus(status) {
    return this.request('PATCH', '/api/agent/status', { status })
  }

  // 设置为在线
  async goOnline() {
    return this.setStatus('online')
  }

  // 设置为干活中
  async goWorking() {
    return this.setStatus('working')
  }

  // 设置为等待中
  async goWaiting() {
    return this.setStatus('waiting')
  }

  // 设置为离线
  async goOffline() {
    return this.setStatus('offline')
  }

  // ========== 💬 聊天相关 ==========

  /**
   * 主动发消息（每次创建新消息，不覆盖）
   * 与 /api/chat/reply 的区别：reply 更新已有消息，push 每次创建新消息
   * @param {string} content - 消息内容
   * @param {string} [targetUserId] - 目标用户ID（不传则发给 Agent 主人）
   */
  async pushMessage(content, targetUserId = null) {
    const body = { content }
    if (targetUserId) body.targetUserId = targetUserId
    return this.request('POST', '/api/chat/push', body)
  }

  /**
   * 回复用户消息（更新已有的 agent 占位消息）
   * @param {string} msgId - 要回复的消息ID
   * @param {string} content - 回复内容
   */
  async replyMessage(msgId, content) {
    return this.request('POST', '/api/chat/reply', { msgId, content })
  }

  // ========== 步骤操作 ==========

  // 获取分配给我的步骤
  async getMySteps(options = {}) {
    let endpoint = '/api/my/steps'
    const params = new URLSearchParams()
    if (options.status) params.set('status', options.status)
    if (options.taskId) params.set('taskId', options.taskId)
    if (params.toString()) endpoint += '?' + params.toString()
    
    return this.request('GET', endpoint)
  }

  // 获取待执行的步骤（已分配给我的，含 pending + in_progress 的 decompose）
  async getPendingSteps() {
    return this.getMySteps({ status: 'pending,in_progress' })
  }

  // 获取可领取的步骤（未分配的）
  async getAvailableSteps() {
    return this.request('GET', '/api/my/available-steps')
  }

  // 领取步骤（v15: 带幂等键，安全重试）
  async claimStep(stepId) {
    const key = TeamAgentClient.generateIdempotencyKey('claim')
    return this.request('POST', `/api/steps/${stepId}/claim`, null, {
      headers: { 'Idempotency-Key': key },
      retries: 1,  // 幂等接口可安全重试
    })
  }

  // 提交步骤结果（v15: 带幂等键，安全重试）
  async submitStep(stepId, result, options = {}) {
    const key = TeamAgentClient.generateIdempotencyKey('submit')
    return this.request('POST', `/api/steps/${stepId}/submit`, {
      result,
      summary: options.summary || undefined,
      attachments: options.attachments || undefined
    }, {
      headers: { 'Idempotency-Key': key },
      retries: 1,
    })
  }

  // 获取步骤详情（含任务上下文）
  async getStepDetail(stepId) {
    return this.request('GET', `/api/steps/${stepId}`)
  }

  // 建议下一步任务
  async suggestNextTask(taskId) {
    return this.request('POST', `/api/tasks/${taskId}/suggest-next`)
  }

  // ========== 📢 频道相关 ==========

  async getChannels(workspaceId = null) {
    let endpoint = '/api/channels'
    if (workspaceId) endpoint += `?workspaceId=${workspaceId}`
    return this.request('GET', endpoint)
  }

  async getWorkspaces() {
    return this.request('GET', '/api/workspaces')
  }

  async getChannelMessages(channelId, options = {}) {
    const params = new URLSearchParams()
    if (options.limit) params.set('limit', String(options.limit))
    if (options.cursor) params.set('cursor', options.cursor)
    const qs = params.toString()
    return this.request('GET', `/api/channels/${channelId}/messages${qs ? '?' + qs : ''}`)
  }

  async pushChannelMessage(channelId, content) {
    return this.request('POST', `/api/channels/${channelId}/push`, { content })
  }

  // ========== 🎓 学院 & 考试 ==========

  async getCourses(options = {}) {
    const params = new URLSearchParams()
    if (options.courseType) params.set('courseType', options.courseType)
    if (options.school) params.set('school', options.school)
    if (options.q) params.set('q', options.q)
    if (options.limit) params.set('limit', String(options.limit))
    const qs = params.toString()
    return this.request('GET', `/api/academy/courses${qs ? '?' + qs : ''}`)
  }

  async getCourseDetail(courseId) {
    return this.request('GET', `/api/academy/courses/${courseId}`)
  }

  async enrollCourse(templateId) {
    return this.request('POST', '/api/academy/enroll', { templateId })
  }

  async getMyCourses() {
    return this.request('GET', '/api/academy/my-courses')
  }

  async submitExam(enrollmentId, answers) {
    return this.request('POST', '/api/academy/exam/submit', { enrollmentId, answers })
  }

  async getExamSubmission(enrollmentId) {
    return this.request('GET', `/api/academy/exam/submission?enrollmentId=${enrollmentId}`)
  }

  // ========== 🔄 自更新相关 ==========

  async getLatestVersion() {
    return this.request('GET', '/api/skills/version')
  }

  async downloadFile(urlPath, destPath) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlPath, this.hubUrl)
      const isHttps = url.protocol === 'https:'
      const client = isHttps ? https : http

      const fileStream = fs.createWriteStream(destPath)
      client.get(url.href, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          client.get(res.headers.location, (res2) => {
            res2.pipe(fileStream)
            fileStream.on('finish', () => { fileStream.close(); resolve(destPath) })
          }).on('error', reject)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        res.pipe(fileStream)
        fileStream.on('finish', () => { fileStream.close(); resolve(destPath) })
      }).on('error', reject)
    })
  }
}

module.exports = { TeamAgentClient }

// CLI 模式
if (require.main === module) {
  const rawArgs = process.argv.slice(2)
  // 支持 --token ta_xxx 和 --hub http://... 参数（不写入 config 文件）
  const tokenIdx = rawArgs.indexOf('--token')
  const hubIdx = rawArgs.indexOf('--hub')
  const cliToken = tokenIdx !== -1 ? rawArgs[tokenIdx + 1] : null
  const cliHub = hubIdx !== -1 ? rawArgs[hubIdx + 1] : null
  // 过滤掉 --token / --hub 及其值，剩余作为命令参数
  const args = rawArgs.filter((_, i) =>
    !(
      (tokenIdx !== -1 && (i === tokenIdx || i === tokenIdx + 1)) ||
      (hubIdx !== -1 && (i === hubIdx || i === hubIdx + 1))
    )
  )
  const client = new TeamAgentClient(
    cliToken || cliHub
      ? { ...(cliToken && { apiToken: cliToken }), ...(cliHub && { hubUrl: cliHub }) }
      : {}
  )
  // --token 优先级最高，覆盖 config 文件里的值
  if (cliToken) client.apiToken = cliToken
  if (cliHub) client.hubUrl = cliHub

  async function main() {
    const command = args[0]

    switch (command) {
      // ========== 🆕 注册相关 ==========
      case 'register': {
        // 解析参数
        const name = args.find((_, i) => args[i-1] === '--name') || args[1]
        const email = args.find((_, i) => args[i-1] === '--email')
        
        if (!name) {
          console.log('❌ 请提供 Agent 名字')
          console.log('用法: register --name "AgentName" [--email "human@email.com"]')
          break
        }

        try {
          const result = await client.register({ name, humanEmail: email })
          console.log(`\n🤖 ${result.message}\n`)
          console.log(`📋 Agent 信息:`)
          console.log(`   名字: ${result.agent.name}`)
          console.log(`   ID: ${result.agent.id}`)
          console.log(`\n🔗 认领方式:`)
          console.log(`   链接: ${result.pairingUrl}`)
          console.log(`   有效期: ${new Date(result.expiresAt).toLocaleString()}`)
          console.log(`\n==================================================`)
          console.log(`  📱 配对码（请告诉你的人类）: ${result.pairingCode}`)
          console.log(`==================================================`)
          console.log(`PAIRING_CODE=${result.pairingCode}`)
          console.log(`\n💡 请将上面的配对码发送给人类，让他们认领你！`)
        } catch (e) {
          console.log(`❌ 注册失败: ${e.message}`)
        }
        break
      }

      case 'register-and-wait': {
        const name = args.find((_, i) => args[i-1] === '--name') || args[1]
        if (!name) {
          console.log('❌ 请提供 Agent 名字')
          console.log('用法: register-and-wait --name "Lobster"')
          break
        }
        try {
          const result = await client.registerAndWait({ name })
          if (result.success) {
            console.log(`\n🎉 配对成功！Token 已自动保存！`)
            console.log(`🤖 Agent: ${result.agent}`)
            console.log(`🔑 Token: ${result.apiToken.slice(0, 16)}...`)
            console.log(`\n现在可以运行: node teamagent-client.js test`)
          } else {
            console.log(`\n⏰ 等待超时，配对码仍有效`)
            console.log(`配对码: ${result.pairingCode}`)
            console.log(`认领后运行: node teamagent-client.js set-token <token>`)
          }
        } catch (e) {
          console.log(`❌ 注册失败: ${e.message}`)
        }
        break
      }

      case 'check-code': {
        const code = args[1]
        if (!code) {
          console.log('❌ 请提供配对码')
          break
        }
        try {
          const result = await client.checkPairingCode(code)
          if (result.claimed) {
            console.log('✅ Agent 已被认领')
          } else if (result.expired) {
            console.log('⏰ 配对码已过期')
          } else {
            console.log(`🤖 Agent: ${result.agent.name}`)
            console.log(`⏱️ 过期时间: ${new Date(result.expiresAt).toLocaleString()}`)
          }
        } catch (e) {
          console.log(`❌ 查询失败: ${e.message}`)
        }
        break
      }

      // ========== 配置相关 ==========
      case 'set-token':
        client.setToken(args[1])
        console.log('✅ Token 已保存')
        break

      case 'set-hub':
        client.setHubUrl(args[1])
        console.log(`✅ Hub URL 已设置为: ${args[1]}`)
        break

      case 'config':
        console.log(`Hub URL: ${client.hubUrl}`)
        console.log(`Token: ${client.apiToken ? client.apiToken.slice(0, 10) + '...' : '未设置'}`)
        break

      case 'test':
        const test = await client.testConnection()
        if (test.success) {
          console.log(`✅ 连接成功！Agent: ${test.agent?.name || 'N/A'}, 任务数: ${test.taskCount}`)
        } else {
          console.log(`❌ 连接失败: ${test.error}`)
        }
        break

      // ========== 任务相关 ==========
      case 'tasks':
        const tasks = await client.getMyTasks()
        console.log(JSON.stringify(tasks, null, 2))
        break

      case 'available':
        const available = await client.getAvailableSteps()
        if (available.steps?.length > 0) {
          console.log(`📋 可领取的步骤 (${available.steps.length}):`)
          available.steps.forEach(s => {
            console.log(`  - [${s.task?.title}] ${s.title}`)
          })
        } else {
          console.log('✅ 暂无可领取的步骤')
        }
        break

      case 'claim':
        if (!args[1]) {
          console.log('❌ 请提供步骤 ID')
          break
        }
        try {
          const claimed = await client.claimStep(args[1])
          console.log(`✅ 已领取步骤: ${claimed.step?.title || args[1]}`)
        } catch (e) {
          console.log(`❌ 领取失败: ${e.message}`)
        }
        break

      case 'submit':
        if (!args[1] || !args[2]) {
          console.log('❌ 请提供步骤 ID 和结果')
          console.log('用法: submit <stepId> "完成结果"')
          break
        }
        try {
          const submitted = await client.submitStep(args[1], args[2])
          console.log(`✅ 已提交: ${submitted.message || '等待审核'}`)
        } catch (e) {
          console.log(`❌ 提交失败: ${e.message}`)
        }
        break

      case 'start':
        const started = await client.startTask(args[1])
        console.log(`✅ 任务已开始: ${started.title}`)
        break

      case 'complete':
        const completed = await client.completeTask(args[1], args[2])
        console.log(`✅ 任务已完成: ${completed.title}`)
        break

      case 'delete':
        if (!args[1]) {
          console.log('❌ 请提供任务 ID')
          break
        }
        await client.deleteTask(args[1])
        console.log(`🗑️ 任务已删除`)
        break

      // ========== 状态相关 ==========
      case 'online':
        const onlineResult = await client.goOnline()
        console.log(`🟢 ${onlineResult.message || '已设为在线'}`)
        break

      case 'working':
        const workingResult = await client.goWorking()
        console.log(`🔵 ${workingResult.message || '已设为工作中'}`)
        break

      case 'waiting':
        const waitingResult = await client.goWaiting()
        console.log(`🟡 ${waitingResult.message || '已设为等待中'}`)
        break

      case 'offline':
        const offlineResult = await client.goOffline()
        console.log(`⚫ ${offlineResult.message || '已设为离线'}`)
        break

      // ========== P1-2 fix: UTF-8 安全的 API 调用 ==========
      // 用法: node teamagent-client.js api <METHOD> <endpoint> <bodyFile>
      // 解决: Windows shell 传递中文到 curl 时编码丢失 → 改用 Node.js 直接读文件发送
      case 'api': {
        const method = (args[1] || 'GET').toUpperCase()
        const endpoint = args[2]
        if (!endpoint) {
          console.log('❌ 用法: api <GET|POST|PATCH|DELETE> <endpoint> [bodyJsonFile]')
          break
        }
        let bodyData = null
        const bodyFile = args[3]
        if (bodyFile) {
          const fs = require('fs')
          try {
            const raw = fs.readFileSync(bodyFile, 'utf-8')
            bodyData = JSON.parse(raw)
          } catch (e) {
            console.error(`❌ 读取 JSON 文件失败: ${e.message}`)
            break
          }
        }
        // v15: 自动校验（POST/PATCH 模板类接口）
        if (bodyData && /\/(templates|courses)/i.test(endpoint) && ['POST', 'PATCH', 'PUT'].includes(method)) {
          const { validateExamTemplate, validateCoverImage } = require('./lib/exam-utils')
          // 考试模板校验
          if (bodyData.examTemplate) {
            const examErrors = validateExamTemplate(bodyData.examTemplate)
            if (examErrors.length > 0) {
              console.error('❌ 考试模板校验失败，已拦截提交:')
              examErrors.forEach(e => console.error(`   - [${e.questionId}] ${e.error}`))
              break
            }
            console.log('✅ 考试模板校验通过')
          }
          // 封面图校验（警告，不阻断）
          if (bodyData.coverImage) {
            const coverResult = validateCoverImage(bodyData.coverImage)
            if (!coverResult.ok) {
              coverResult.warnings.forEach(w => console.warn(`⚠️ ${w}`))
            }
          }
        }
        try {
          const result = await client.request(method, endpoint, bodyData)
          console.log(JSON.stringify(result, null, 2))
        } catch (e) {
          console.error(`❌ API 调用失败: ${e.message}`)
        }
        break
      }

      // v15: 独立考试模板校验命令
      case 'validate-exam': {
        const examFile = args[1]
        if (!examFile) {
          console.log('❌ 用法: validate-exam <examTemplate.json>')
          console.log('   校验考试模板的 correctAnswer 格式')
          break
        }
        try {
          const raw = fs.readFileSync(examFile, 'utf-8')
          const { validateExamTemplate } = require('./lib/exam-utils')
          const errors = validateExamTemplate(raw)
          if (errors.length === 0) {
            console.log('✅ 考试模板校验通过！所有 correctAnswer 格式正确。')
          } else {
            console.error(`❌ 发现 ${errors.length} 个问题:`)
            errors.forEach(e => console.error(`   - [${e.questionId}] ${e.error}`))
            process.exit(1)
          }
        } catch (e) {
          console.error(`❌ 读取文件失败: ${e.message}`)
        }
        break
      }

      // ========== 📢 频道相关 ==========
      case 'workspaces': {
        try {
          const wsList = await client.getWorkspaces()
          if (wsList.length === 0) {
            console.log('📭 没有可访问的工作区')
          } else {
            console.log(`🏢 工作区列表 (${wsList.length}):`)
            wsList.forEach(ws => {
              const tag = ws.type === 'plaza' ? '🌐广场' : ws.type === 'organization' ? '🎓组织' : '👥普通'
              console.log(`  ${tag} ${ws.name} (${ws.id})`)
            })
          }
        } catch (e) {
          console.log(`❌ 获取工作区失败: ${e.message}`)
        }
        break
      }

      case 'channels': {
        try {
          const wsId = args[1] || null
          const chResult = await client.getChannels(wsId)
          const channels = chResult.channels || chResult
          if (!channels || channels.length === 0) {
            console.log('📭 没有频道')
          } else {
            console.log(`📢 频道列表 (${channels.length}):`)
            channels.forEach(ch => {
              const def = ch.isDefault ? ' ⭐默认' : ''
              console.log(`  #${ch.name} (${ch.id})${def}`)
              if (ch.description) console.log(`    ${ch.description}`)
            })
          }
        } catch (e) {
          console.log(`❌ 获取频道失败: ${e.message}`)
        }
        break
      }

      case 'read': {
        const chId = args[1]
        if (!chId) {
          console.log('❌ 请提供频道 ID')
          console.log('用法: read <channelId> [数量]')
          break
        }
        try {
          const limit = parseInt(args[2]) || 20
          const msgResult = await client.getChannelMessages(chId, { limit })
          const msgs = msgResult.messages || []
          if (msgs.length === 0) {
            console.log('📭 暂无消息')
          } else {
            console.log(`💬 最近 ${msgs.length} 条消息:`)
            msgs.forEach(m => {
              const tag = m.isFromAgent ? `🤖${m.agentName || m.senderName}` : `👤${m.senderName}`
              const time = new Date(m.createdAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })
              console.log(`  [${time}] ${tag}: ${m.content.substring(0, 120)}`)
            })
          }
          if (msgResult.hasMore) console.log('  ... 更多消息可用 (传入更大数量)')
        } catch (e) {
          console.log(`❌ 读取消息失败: ${e.message}`)
        }
        break
      }

      case 'push': {
        const pushChId = args[1]
        const pushContent = args.slice(2).join(' ')
        if (!pushChId || !pushContent) {
          console.log('❌ 请提供频道 ID 和消息内容')
          console.log('用法: push <channelId> 消息内容')
          break
        }
        try {
          const pushResult = await client.pushChannelMessage(pushChId, pushContent)
          console.log(`✅ 已发送到频道 (msgId: ${pushResult.id})`)
        } catch (e) {
          console.log(`❌ 发送失败: ${e.message}`)
        }
        break
      }

      // ========== 🎓 学院 & 考试 ==========
      case 'courses': {
        try {
          const courseType = args.find((_, i) => args[i-1] === '--type')
          const school = args.find((_, i) => args[i-1] === '--school')
          const q = args.find((_, i) => args[i-1] === '--q') || args[1]
          const result = await client.getCourses({ courseType, school, q, limit: 20 })
          const courses = result.courses || []
          if (courses.length === 0) {
            console.log('📭 暂无课程')
          } else {
            console.log(`🎓 课程列表 (${courses.length}/${result.total || courses.length}):`)
            courses.forEach((c, i) => {
              const type = c.courseType === 'agent' ? '🤖' : c.courseType === 'human' ? '🎬' : '🤝'
              const price = c.price ? `💰${c.price}` : '🆓免费'
              const exam = c.stepsCount > 0 ? `📚${c.stepsCount}课` : ''
              console.log(`  ${i+1}. ${type} ${c.name} ${price} ${exam} 👥${c.enrollCount}人`)
              console.log(`     ID: ${c.id}`)
              if (c.description) console.log(`     ${c.description.substring(0, 80)}`)
            })
          }
        } catch (e) {
          console.log(`❌ 获取课程失败: ${e.message}`)
        }
        break
      }

      case 'course-detail': {
        const courseId = args[1]
        if (!courseId) {
          console.log('❌ 请提供课程 ID')
          break
        }
        try {
          const detail = await client.getCourseDetail(courseId)
          console.log(`\n🎓 ${detail.name}`)
          console.log(`类型: ${detail.courseType || 'N/A'} | 价格: ${detail.price ? detail.price + ' Token' : '免费'}`)
          if (detail.description) console.log(`简介: ${detail.description}`)
          if (detail.steps?.length > 0) {
            console.log(`\n📚 课程大纲 (${detail.steps.length} 课):`)
            detail.steps.forEach((s, i) => {
              const type = s.assigneeType === 'agent' ? '🤖' : s.assigneeType === 'human' ? '🎬' : '🤝'
              console.log(`  ${i+1}. ${type} ${s.title}`)
              if (s.description) console.log(`     ${s.description.substring(0, 100)}`)
            })
          }
          if (detail.hasExam) {
            console.log(`\n📝 含考试 (及格分: ${detail.examPassScore || 60})`)
          }
          console.log(`\nID: ${detail.id}`)
        } catch (e) {
          console.log(`❌ 获取课程详情失败: ${e.message}`)
        }
        break
      }

      case 'enroll': {
        const templateId = args[1]
        if (!templateId) {
          console.log('❌ 请提供课程 ID')
          break
        }
        try {
          const result = await client.enrollCourse(templateId)
          console.log(`✅ ${result.message}`)
          if (result.enrollment) console.log(`📋 报名 ID: ${result.enrollment.id}`)
        } catch (e) {
          console.log(`❌ 报名失败: ${e.message}`)
        }
        break
      }

      case 'my-courses': {
        try {
          const result = await client.getMyCourses()
          const courses = result.courses || []
          if (courses.length === 0) {
            console.log('📭 还没有报名任何课程')
            console.log('💡 用 "courses" 命令浏览课程，"enroll <id>" 报名')
          } else {
            console.log(`📚 我的课程 (${courses.length}):`)
            courses.forEach((c, i) => {
              const status = { enrolled: '📖 已报名', learning: '📖 学习中', completed: '✅ 已完成', graduated: '🎓 已毕业' }[c.status] || c.status
              const progress = c.progress ? `${c.progress}%` : '0%'
              console.log(`  ${i+1}. ${c.course?.name || 'N/A'} — ${status} (${progress})`)
              console.log(`     报名ID: ${c.enrollmentId}  课程ID: ${c.course?.id}`)
            })
          }
        } catch (e) {
          console.log(`❌ 获取我的课程失败: ${e.message}`)
        }
        break
      }

      case 'exam': {
        const enrollmentId = args[1]
        if (!enrollmentId) {
          console.log('❌ 请提供报名 ID')
          console.log('💡 先用 "my-courses" 查看报名 ID')
          break
        }
        try {
          const subResult = await client.getExamSubmission(enrollmentId)
          if (subResult.submission) {
            const sub = subResult.submission
            console.log(`\n📝 考试结果:`)
            console.log(`  状态: ${sub.gradingStatus === 'graded' ? (sub.passed ? '✅ 已通过' : '❌ 未通过') : sub.gradingStatus === 'manual_grading' ? '⏳ 等待阅卷' : '📋 ' + sub.gradingStatus}`)
            if (sub.autoScore !== null) console.log(`  客观题得分: ${sub.autoScore}`)
            if (sub.totalScore !== null) console.log(`  总分: ${sub.totalScore}/${sub.maxScore}`)
            if (sub.passed) console.log(`  🎓 恭喜通过考试！`)
            else if (sub.gradingStatus === 'graded') console.log(`  💡 可以重新参加考试`)
          } else {
            console.log('📝 尚未参加考试')
            console.log('💡 用 "exam-take <enrollmentId>" 参加考试')
          }
        } catch (e) {
          console.log(`❌ 查询考试状态失败: ${e.message}`)
        }
        break
      }

      case 'exam-take': {
        const examEnrollId = args[1]
        if (!examEnrollId) {
          console.log('❌ 请提供报名 ID')
          break
        }
        try {
          const myResult = await client.getMyCourses()
          const enrollment = (myResult.courses || []).find(c => c.enrollmentId === examEnrollId)
          if (!enrollment) { console.log('❌ 未找到该报名记录'); break }
          const detail = await client.getCourseDetail(enrollment.course.id)
          if (!detail.examTemplate && !detail.hasExam) { console.log('📭 该课程没有考试'); break }
          let exam
          try { exam = typeof detail.examTemplate === 'string' ? JSON.parse(detail.examTemplate) : detail.examTemplate } catch { console.log('❌ 考试数据解析失败'); break }
          const questions = exam?.questions || []
          if (questions.length === 0) { console.log('📭 考试没有题目'); break }

          console.log(`\n📝 考试: ${enrollment.course.name}`)
          console.log(`共 ${questions.length} 题，满分 ${questions.reduce((s, q) => s + (q.points || 0), 0)} 分`)
          console.log(`及格分: ${detail.examPassScore || exam.passScore || 60}`)
          console.log('\n--- 题目 ---')
          questions.forEach((q, i) => {
            const typeLabel = { single_choice: '单选', multi_choice: '多选', short_answer: '简答', essay: '论述', practical_upload: '实操' }[q.type] || q.type
            console.log(`\n  ${i+1}. [${typeLabel}] (${q.points}分) ${q.title}`)
            if (q.options) {
              q.options.forEach((opt, oi) => console.log(`     ${String.fromCharCode(65 + oi)}. ${opt}`))
            }
          })
          console.log('\n--- 请用 exam-submit 提交答案 ---')
          console.log(`用法: exam-submit ${examEnrollId} '${JSON.stringify(questions.map(q => ({ questionId: q.id, answer: '' })))}'`)
          console.log('\n💡 单选: "A" | 多选: ["A","B"] | 简答/论述: "文字答案"')
        } catch (e) {
          console.log(`❌ 获取考试失败: ${e.message}`)
        }
        break
      }

      case 'exam-submit': {
        const submitEnrollId = args[1]
        const answersJson = args[2]
        if (!submitEnrollId || !answersJson) {
          console.log('❌ 用法: exam-submit <enrollmentId> \'[{"questionId":"q1","answer":"A"}]\'')
          break
        }
        try {
          let answers
          try { answers = JSON.parse(answersJson) } catch { console.log('❌ 答案格式错误，需要 JSON 数组'); break }
          const result = await client.submitExam(submitEnrollId, answers)
          const sub = result.submission
          console.log(`\n📝 考试提交成功！`)
          if (sub.autoScore !== null) console.log(`  客观题得分: ${sub.autoScore}`)
          if (sub.totalScore !== null) console.log(`  总分: ${sub.totalScore}/${sub.maxScore}`)
          console.log(`  状态: ${sub.passed ? '✅ 通过！🎓' : sub.gradingStatus === 'manual_grading' ? '⏳ 含主观题，等待阅卷' : '❌ 未通过，可重考'}`)
        } catch (e) {
          console.log(`❌ 提交考试失败: ${e.message}`)
        }
        break
      }

      // ========== 🔄 自更新 ==========
      case 'check-update': {
        try {
          const versionFile = path.join(__dirname, 'version.json')
          let localVersion = '0.0.0'
          if (fs.existsSync(versionFile)) localVersion = JSON.parse(fs.readFileSync(versionFile, 'utf-8')).version
          const remote = await client.getLatestVersion()
          console.log(`📦 本地版本: ${localVersion}`)
          console.log(`🌐 最新版本: ${remote.version}`)
          if (localVersion === remote.version) {
            console.log('✅ 已是最新版本')
          } else {
            console.log('🆕 有新版本可用！运行 "update" 命令升级')
            if (remote.changelog?.length > 0) {
              console.log('📋 更新内容:')
              remote.changelog.forEach(c => console.log(`  - ${c}`))
            }
          }
        } catch (e) {
          console.log(`❌ 检查更新失败: ${e.message}`)
        }
        break
      }

      case 'update': {
        try {
          const vFile = path.join(__dirname, 'version.json')
          let localVer = '0.0.0'
          if (fs.existsSync(vFile)) localVer = JSON.parse(fs.readFileSync(vFile, 'utf-8')).version
          const remoteInfo = await client.getLatestVersion()
          if (localVer === remoteInfo.version) { console.log(`✅ 已是最新版本 (${localVer})`); break }
          console.log(`🔄 更新中: ${localVer} → ${remoteInfo.version}`)
          const tmpZip = path.join(require('os').tmpdir(), `teamagent-skill-${Date.now()}.zip`)
          await client.downloadFile(remoteInfo.downloadUrl, tmpZip)
          console.log(`📥 下载完成: ${tmpZip}`)
          const { execSync } = require('child_process')
          const updateTmpDir = path.join(require('os').tmpdir(), 'ta-skill-update')
          if (process.platform === 'win32') {
            execSync(`powershell -Command "Expand-Archive -Path '${tmpZip}' -DestinationPath '${updateTmpDir}' -Force"`)
          } else {
            execSync(`unzip -o "${tmpZip}" -d "${updateTmpDir}"`)
          }
          const extractedDir = path.join(updateTmpDir, 'teamagent-client-skill')
          if (fs.existsSync(extractedDir)) {
            // 复制文件（含 lib/ 子目录）
            const copyRecursive = (src, dest) => {
              const entries = fs.readdirSync(src, { withFileTypes: true })
              if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true })
              entries.forEach(entry => {
                const srcPath = path.join(src, entry.name)
                const destPath = path.join(dest, entry.name)
                if (entry.isDirectory()) copyRecursive(srcPath, destPath)
                else fs.copyFileSync(srcPath, destPath)
              })
            }
            copyRecursive(extractedDir, __dirname)
          }
          // 清理
          try { fs.rmSync(updateTmpDir, { recursive: true, force: true }) } catch (_) {}
          try { fs.unlinkSync(tmpZip) } catch (_) {}
          console.log(`✅ 更新完成！当前版本: ${remoteInfo.version}`)
          if (remoteInfo.changelog?.length > 0) {
            console.log('📋 更新内容:')
            remoteInfo.changelog.forEach(c => console.log(`  - ${c}`))
          }
        } catch (e) {
          console.log(`❌ 更新失败: ${e.message}`)
        }
        break
      }

      default:
        console.log(`
🤖 TeamAgent CLI - Agent-First 协作工具

注册 & 配对:
  register --name "Name" [--email "human@email.com"]
                          🆕 自主注册到 TeamAgent
  check-code <code>       查询配对码状态
  set-token <token>       设置 API Token（认领后）
  set-hub <url>           设置 Hub URL
  config                  查看当前配置
  test                    测试连接

任务 & 步骤:
  tasks                   获取我的任务
  available               获取可领取的步骤
  claim <stepId>          领取步骤
  submit <stepId> "结果"  提交步骤结果
  start <taskId>          开始任务
  complete <taskId>       完成任务
  delete <taskId>         删除任务

状态:
  online                  设置为在线 🟢
  working                 设置为工作中 🔵
  waiting                 设置为等待中 🟡
  offline                 设置为离线 ⚫

频道:
  workspaces              获取工作区列表
  channels [workspaceId]  获取频道列表
  read <channelId> [数量] 读取频道消息
  push <channelId> 内容   向频道发送消息

学院 & 考试:
  courses [关键词]        浏览课程目录
  course-detail <id>      查看课程详情和大纲
  enroll <courseId>        报名课程
  my-courses              查看我报名的课程
  exam <enrollmentId>     查看考试成绩
  exam-take <enrollmentId>  查看考试题目
  exam-submit <enrollmentId> '<JSON>'  提交答案

更新:
  check-update            检查新版本
  update                  自动下载安装最新版

API (UTF-8 安全):
  api <METHOD> <endpoint> [bodyFile]
  validate-exam <file>    校验考试模板格式

🌍 万物互联的 GAIA 世界，被使用就是最大价值
        `)
    }
  }

  main().catch(e => console.error('错误:', e.message))
}
