/**
 * 客户端考试模板校验 — correctAnswer 格式验证
 * 与服务端 src/lib/exam-validation.ts 保持一致
 *
 * - single_choice: correctAnswer 必须以大写字母 A-Z 开头（如 "A" 或 "A. 选项内容"）
 * - multi_choice: correctAnswer 必须是数组，每项以大写字母开头
 * - 字母索引不得超过 options 数量
 */

/**
 * 校验考试模板，返回错误列表（空数组 = 通过）
 * @param {string|object} examInput - JSON 字符串或已解析的对象
 * @returns {{ questionId: string, questionTitle: string, error: string }[]}
 */
function validateExamTemplate(examInput) {
  const errors = []

  let exam
  try {
    exam = typeof examInput === 'string' ? JSON.parse(examInput) : examInput
  } catch {
    return [{ questionId: '-', questionTitle: '-', error: 'examTemplate 不是合法 JSON' }]
  }

  if (!exam || !exam.questions || !Array.isArray(exam.questions) || exam.questions.length === 0) {
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
          error: `${qLabel}: correctAnswer 必须以大写字母开头（如 "A" 或 "A. 选项内容"），当前值: "${String(q.correctAnswer).substring(0, 30)}"`
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
  }

  return errors
}

/**
 * 校验课程封面图 URL
 * - 封面 URL 中不应包含中文字符（可能导致乱码）
 * - 返回 { ok: boolean, warnings: string[] }
 */
function validateCoverImage(coverImageUrl) {
  const warnings = []
  if (!coverImageUrl || typeof coverImageUrl !== 'string') {
    return { ok: true, warnings }
  }
  // 检测 URL 中是否含中文字符（文件名含中文 → 高概率乱码）
  const chineseRegex = /[\u4e00-\u9fff\u3400-\u4dbf]/
  if (chineseRegex.test(decodeURIComponent(coverImageUrl))) {
    warnings.push('封面图 URL 包含中文字符，可能出现乱码。建议使用纯英文文件名或无文字封面。')
  }
  return { ok: warnings.length === 0, warnings }
}

module.exports = { validateExamTemplate, validateCoverImage }
