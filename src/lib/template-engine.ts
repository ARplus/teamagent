/**
 * 模版引擎 — 变量替换 + 步骤实例化
 */

export interface VariableDefinition {
  name: string
  label: string
  type: 'string' | 'number' | 'date' | 'select'
  required?: boolean
  default?: any
  description?: string
  options?: string[]
}

export interface StepTemplate {
  order: number
  title: string
  description?: string
  skillRef?: string | null
  promptTemplate?: string | null
  assigneeRole?: string        // "agent" | "human" | "auto"
  assigneeId?: string | null   // 兼容旧格式
  assigneeType?: string        // 兼容旧格式
  requiresApproval?: boolean
  parallelGroup?: string | null
  inputs?: string[] | null
  outputs?: string[] | null
  skills?: string[] | null
  stepType?: string
}

/**
 * 获取内置变量（每次执行时动态生成）
 */
export function getBuiltinVariables(creatorName?: string, workspaceName?: string): Record<string, string> {
  const now = new Date()
  return {
    TODAY: now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-'),
    NOW: now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    CREATOR: creatorName || '系统',
    WORKSPACE: workspaceName || '',
  }
}

/**
 * 替换字符串中的 {{变量}} 占位符
 */
export function resolveVariables(text: string, variables: Record<string, any>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, name) => {
    if (name in variables) {
      return String(variables[name])
    }
    return match // 未匹配的保留原样
  })
}

/**
 * 校验用户提供的变量是否满足模版定义
 */
export function validateVariables(
  definitions: VariableDefinition[],
  provided: Record<string, any>
): { valid: boolean; errors: string[]; resolved: Record<string, any> } {
  const errors: string[] = []
  const resolved: Record<string, any> = {}

  for (const def of definitions) {
    const value = provided[def.name]

    if (value === undefined || value === null || value === '') {
      if (def.required && def.default === undefined) {
        errors.push(`变量 "${def.label || def.name}" 是必填项`)
        continue
      }
      // 使用默认值
      resolved[def.name] = def.default ?? ''
    } else {
      // 类型检查
      if (def.type === 'number' && isNaN(Number(value))) {
        errors.push(`变量 "${def.label || def.name}" 需要是数字`)
        continue
      }
      if (def.type === 'select' && def.options && !def.options.includes(String(value))) {
        errors.push(`变量 "${def.label || def.name}" 的值不在可选范围内`)
        continue
      }
      resolved[def.name] = value
    }
  }

  return { valid: errors.length === 0, errors, resolved }
}

/**
 * 将步骤模板实例化为真实的步骤数据（替换变量、生成标题描述）
 */
export function instantiateSteps(
  stepsTemplate: StepTemplate[],
  variables: Record<string, any>
): Array<{
  title: string
  description: string | null
  order: number
  stepType: string
  assigneeId: string | null
  requiresApproval: boolean
  parallelGroup: string | null
  inputs: string | null
  outputs: string | null
  skills: string | null
}> {
  return stepsTemplate.map((s, i) => {
    const title = resolveVariables(s.title, variables)
    const description = s.description ? resolveVariables(s.description, variables) : null

    // 如果有 promptTemplate，把它追加到 description 中（Agent 执行时可读）
    let finalDesc = description
    if (s.promptTemplate) {
      const prompt = resolveVariables(s.promptTemplate, variables)
      finalDesc = finalDesc ? `${finalDesc}\n\n---\n**Prompt:** ${prompt}` : prompt
    }

    // 处理 skills：合并 skillRef 和 skills
    let skillsList = s.skills ? [...s.skills] : []
    if (s.skillRef && !skillsList.includes(s.skillRef)) {
      skillsList.unshift(s.skillRef)
    }

    return {
      title,
      description: finalDesc,
      order: s.order ?? (i + 1),
      stepType: s.stepType || 'task',
      assigneeId: s.assigneeId || null,
      requiresApproval: s.requiresApproval !== false,
      parallelGroup: s.parallelGroup || null,
      inputs: s.inputs ? JSON.stringify(s.inputs.map(inp => resolveVariables(inp, variables))) : null,
      outputs: s.outputs ? JSON.stringify(s.outputs.map(out => resolveVariables(out, variables))) : null,
      skills: skillsList.length > 0 ? JSON.stringify(skillsList) : null,
    }
  })
}
