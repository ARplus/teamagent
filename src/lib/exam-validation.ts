/**
 * 考试模板校验 — correctAnswer 格式验证
 *
 * - single_choice: correctAnswer 必须以大写字母 A-Z 开头（如 "A. 选项1"）
 * - multi_choice: correctAnswer 必须是数组，每项以大写字母开头
 * - 字母索引不得超过 options 数量
 */

export interface ExamQuestion {
  id: string
  type: string
  title: string
  points?: number
  options?: string[]
  correctAnswer?: string | string[]
  referenceAnswer?: string
}

export interface ExamTemplate {
  passScore?: number
  questions: ExamQuestion[]
}

export interface ValidationError {
  questionId: string
  questionTitle: string
  error: string
}

/**
 * 校验考试模板，返回错误列表（空 = 通过）
 */
export function validateExamTemplate(examJson: string): ValidationError[] {
  const errors: ValidationError[] = []

  let exam: ExamTemplate
  try {
    exam = JSON.parse(examJson)
  } catch {
    return [{ questionId: '-', questionTitle: '-', error: 'examTemplate 不是合法 JSON' }]
  }

  if (!exam.questions || !Array.isArray(exam.questions) || exam.questions.length === 0) {
    return [{ questionId: '-', questionTitle: '-', error: '考试至少需要 1 道题' }]
  }

  for (const q of exam.questions) {
    const qLabel = `题目 ${q.id || '?'}`

    if (q.type === 'single_choice') {
      // 必须有 options
      if (!q.options || !Array.isArray(q.options) || q.options.length < 2) {
        errors.push({ questionId: q.id, questionTitle: q.title, error: `${qLabel}: 单选题至少需要 2 个选项` })
        continue
      }
      // correctAnswer 必须存在且以大写字母开头
      if (!q.correctAnswer || typeof q.correctAnswer !== 'string') {
        errors.push({ questionId: q.id, questionTitle: q.title, error: `${qLabel}: 单选题必须设置 correctAnswer` })
        continue
      }
      const letterMatch = q.correctAnswer.match(/^([A-Z])/)
      if (!letterMatch) {
        errors.push({
          questionId: q.id, questionTitle: q.title,
          error: `${qLabel}: correctAnswer 必须以大写字母开头（如 "A. 选项内容"），当前值: "${q.correctAnswer.substring(0, 30)}"`
        })
        continue
      }
      // 字母索引不超过选项数
      const letterIndex = letterMatch[1].charCodeAt(0) - 65 // A=0, B=1, ...
      if (letterIndex >= q.options.length) {
        errors.push({
          questionId: q.id, questionTitle: q.title,
          error: `${qLabel}: correctAnswer "${letterMatch[1]}" 超出选项范围（共 ${q.options.length} 个选项）`
        })
      }
    }

    if (q.type === 'multi_choice') {
      if (!q.options || !Array.isArray(q.options) || q.options.length < 2) {
        errors.push({ questionId: q.id, questionTitle: q.title, error: `${qLabel}: 多选题至少需要 2 个选项` })
        continue
      }
      if (!q.correctAnswer || !Array.isArray(q.correctAnswer) || q.correctAnswer.length === 0) {
        errors.push({ questionId: q.id, questionTitle: q.title, error: `${qLabel}: 多选题 correctAnswer 必须是非空数组` })
        continue
      }
      for (const ans of q.correctAnswer) {
        if (typeof ans !== 'string') {
          errors.push({ questionId: q.id, questionTitle: q.title, error: `${qLabel}: correctAnswer 数组元素必须是字符串` })
          break
        }
        const m = ans.match(/^([A-Z])/)
        if (!m) {
          errors.push({
            questionId: q.id, questionTitle: q.title,
            error: `${qLabel}: correctAnswer 每项必须以大写字母开头，当前值: "${ans.substring(0, 30)}"`
          })
          break
        }
        const idx = m[1].charCodeAt(0) - 65
        if (idx >= q.options.length) {
          errors.push({
            questionId: q.id, questionTitle: q.title,
            error: `${qLabel}: correctAnswer "${m[1]}" 超出选项范围（共 ${q.options.length} 个选项）`
          })
          break
        }
      }
    }

    // 主观题建议有 referenceAnswer（仅警告，不阻止）
  }

  return errors
}
