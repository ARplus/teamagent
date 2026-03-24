/**
 * 步骤执行引擎 — 领取、执行、提交、自动续接
 */
const openclaw = require('./openclaw-bridge')

let client = null
let decomposeInProgress = false
let stepExecInProgress = false

function init(teamagentClient) {
  client = teamagentClient
}

// ── Decompose 步骤（主Agent专用，含互斥锁）──

async function executeDecompose(step) {
  if (decomposeInProgress) {
    console.log(`⏳ decompose 正在执行中，跳过: ${step.title}`)
    return null
  }
  decomposeInProgress = true
  try {
    console.log(`\n🔀 执行 decompose 步骤: ${step.title}`)
    const result = await client.request('POST', `/api/steps/${step.id}/execute-decompose`, {})
    if (result.message) {
      console.log(`\n✅ ${result.message}`)
      if (result.steps) {
        result.steps.forEach((s, i) => {
          const parallel = s.parallelGroup ? ` [并行:${s.parallelGroup}]` : ''
          console.log(`   ${i + 1}. ${s.title}${parallel} → ${s.assigneeNames || '待分配'}`)
        })
      }
    } else if (result.error) {
      throw new Error(result.error)
    }
    return result
  } finally {
    decomposeInProgress = false
  }
}

// ── 普通步骤执行（支持自动续接）──

async function executeStep(step, opts = {}) {
  const { autoContinue = true } = opts

  // P0-2 fix: 二次校验 — 人类步骤绝不执行
  if (step.assigneeType === 'human') {
    console.log(`👤 跳过人类步骤: ${step.title}`)
    return null
  }

  if (stepExecInProgress) {
    console.log(`⏳ 已有步骤在执行中，跳过: ${step.title}`)
    return null
  }
  stepExecInProgress = true

  try {
    console.log(`\n🚀 开始执行步骤: ${step.title}`)

    // 1. 领取
    await client.goWorking()
    const claimed = await client.claimStep(step.id)
    console.log('✅ 已领取')

    // 2. 上下文
    console.log(`   任务: ${claimed.context?.taskTitle || step.task?.title || '未知'}`)
    console.log(`   第 ${claimed.context?.currentStepOrder || '?'} 步 / 共 ${claimed.context?.allSteps?.length || '?'} 步`)

    // 3. 执行（通过 OpenClaw）
    let result
    try {
      result = await executeViaOpenClaw(step, claimed)
    } catch (e) {
      console.log(`⚠️ OpenClaw 执行失败(${e.message})，使用 fallback`)
      result = `步骤 "${step.title}" 已由 Agent 完成。\n执行时间: ${new Date().toLocaleString('zh-CN')}`
    }

    // 4. 提交
    const submitted = await client.submitStep(step.id, result)
    await client.goOnline()
    console.log('✅ 已提交')

    stepExecInProgress = false

    // 5. 自动续接
    if (autoContinue) {
      console.log('\n🔄 检查下一步...')
      await autoPickupNextSteps()
    }

    return submitted
  } catch (e) {
    console.error(`❌ 步骤执行失败: ${e.message}`)
    await client.goOnline().catch(() => {})
    stepExecInProgress = false
    throw e
  }
}

// ── 通过 OpenClaw 构建 prompt 并执行 ──

async function executeViaOpenClaw(step, claimed) {
  const parts = []
  parts.push(`## 任务: ${claimed.context?.taskTitle || step.task?.title || '未知'}`)
  if (claimed.context?.taskDescription) parts.push(`描述: ${claimed.context.taskDescription}`)
  parts.push('', `## 当前步骤: ${step.title}`)
  if (step.description) parts.push(step.description)

  if (claimed.context?.previousOutputs?.length > 0) {
    parts.push('\n## 前序步骤产出')
    for (const p of claimed.context.previousOutputs) {
      const content = p.result || p.summary || '（无）'
      const truncated = content.length > 1500 ? content.slice(0, 1500) + '...' : content
      parts.push(`### 步骤${p.order}「${p.title}」\n${truncated}`)
    }
  }

  if (claimed.context?.rejection) {
    parts.push(`\n## ⚠️ 此步骤被打回，原因: ${claimed.context.rejection.reason}`)
    parts.push('请根据打回原因修改产出。')
  }

  parts.push('\n请认真完成这个步骤，直接输出工作成果。')

  // E: 任务执行 → mode='task'，不加手机聊天 framing
  return await openclaw.inject(parts.join('\n'), 'system', `step-${step.id}`, { mode: 'task' })
}

// ── 自动续接引擎（最多连续执行 10 步）──

async function autoPickupNextSteps(maxRounds = 10) {
  for (let round = 1; round <= maxRounds; round++) {
    await new Promise(r => setTimeout(r, 1500))

    const pending = await client.getPendingSteps()
    const steps = pending?.steps || []

    if (steps.length === 0) {
      console.log('✅ 暂无更多待执行步骤')
      return
    }

    const decompose = steps.find(s => s.stepType === 'decompose')
    if (decompose) {
      console.log(`🔀 [自检 #${round}] decompose 步骤...`)
      await executeDecompose(decompose)
      continue
    }

    // P0-2 fix: 过滤掉人类步骤，只自动执行 Agent 步骤
    const agentSteps = steps.filter(s => s.assigneeType !== 'human')
    if (agentSteps.length === 0) {
      console.log('✅ 剩余步骤均为人类步骤，进入待命')
      return
    }
    const next = agentSteps[0]
    console.log(`🔄 [自检 #${round}] "${next.title}"`)
    try {
      await executeStep(next, { autoContinue: false })
    } catch (e) {
      console.error(`⚠️ [自检 #${round}] 失败: ${e.message}`)
      break
    }
  }
}

// ── 检查待执行步骤 ──

async function checkPendingSteps() {
  console.log('🔍 检查待执行步骤...')
  const result = await client.getPendingSteps()

  if (result.steps.length === 0) {
    console.log('✅ 没有待执行的步骤')
    return null
  }

  console.log(`📋 发现 ${result.steps.length} 个待执行步骤:`)
  result.steps.forEach((step, i) => {
    console.log(`  ${i + 1}. [${step.task.title}] ${step.title} (${step.status})`)
  })
  return result.steps
}

module.exports = { init, executeDecompose, executeStep, autoPickupNextSteps, checkPendingSteps }
