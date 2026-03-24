/**
 * 人机共学考试 — 匹配算法引擎
 * 对应 Lobster 设计的《你和你的 Agent，想法一样吗？》课程
 */
import { forwardToQianwen } from './llm-proxy'

// ── 考试模板格式 ──────────────────────────────────────────

export interface CollabExamPair {
  id: string
  points: number
  matchType: 'choice' | 'semantic' | 'text'  // choice=选择题对比, semantic=主观题语义, text=画像
  label?: string    // 题目标签，用于报告（如"关系定位"）
  human: {
    text: string
    type: 'single_choice' | 'multi_choice' | 'short_answer' | 'essay'
    options?: string[]
  }
  agent: {
    text: string
    type: 'single_choice' | 'multi_choice' | 'short_answer' | 'essay'
    options?: string[]
  }
}

export interface CollabExamTemplate {
  type: 'collab'
  passScore?: number
  pairs: CollabExamPair[]
}

// ── 匹配报告格式 ──────────────────────────────────────────

export interface QuestionMatchScore {
  id: string
  label: string
  matchType: string
  humanAnswer: string
  agentAnswer: string
  score: number        // 0-100
  comment?: string     // 主观题 LLM 分析
}

export interface CollabMatchReport {
  overallMatch: number                 // 0-100 总体匹配度
  questionScores: QuestionMatchScore[]
  mostSimilar: QuestionMatchScore | null
  mostDifferent: QuestionMatchScore | null
  humanPortrait: string                // 人类给 Agent 的一句话画像
  agentPortrait: string                // Agent 给人类的一句话画像
  recommendation: string               // 下一步建议
  generatedAt: string
}

// ── 工具函数 ──────────────────────────────────────────────

/** 将选项字母转换为下标 (A=0, B=1, C=2, D=3) */
function optionIndex(answer: string): number {
  const letter = String(answer).trim().toUpperCase().charAt(0)
  return Math.max(0, letter.charCodeAt(0) - 65)  // A=0, B=1...
}

/** 选择题位置距离 → 匹配分 (0/30/60/100) */
function choiceMatchScore(humanAns: string, agentAns: string): number {
  const h = optionIndex(humanAns)
  const a = optionIndex(agentAns)
  const dist = Math.abs(h - a)
  if (dist === 0) return 100
  if (dist === 1) return 60
  if (dist === 2) return 30
  return 0
}

/** 用千问评估两段主观答案的语义相似度 (0-100) */
async function semanticMatchScore(
  humanAnswer: string,
  agentAnswer: string,
  context: string
): Promise<{ score: number; comment: string }> {
  try {
    const prompt = `你是一个分析人机关系的评估专家。
以下是同一个问题（"${context}"）的两份答案：

【人类回答】：${humanAnswer}
【Agent 回答】：${agentAnswer}

请从"想法是否相似"的角度评估，不评判对错。
返回 JSON：
{
  "score": <0-100整数，越高越相似>,
  "comment": "<一句话描述两者最核心的差异或共同点，不超过30字>"
}`

    const resp = await forwardToQianwen({
      model: 'qwen3.5-flash',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 200,
    })
    if (!resp.ok) throw new Error('LLM error')
    const data = await resp.json()
    const text = data.choices?.[0]?.message?.content || ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
        comment: parsed.comment || '',
      }
    }
  } catch {}
  // fallback: 无法 LLM 时给 50 分（中立）
  return { score: 50, comment: '（语义分析暂时不可用）' }
}

// ── 主函数：生成匹配报告 ──────────────────────────────────

/**
 * @param humanAnswers   人类提交的答案 [{questionId, answer}]
 * @param agentAnswers   Agent 提交的答案 [{questionId, answer}]
 * @param template       ColabExamTemplate（解析后的）
 */
export async function generateMatchReport(
  humanAnswers: Array<{ questionId: string; answer: any }>,
  agentAnswers: Array<{ questionId: string; answer: any }>,
  template: CollabExamTemplate
): Promise<CollabMatchReport> {
  const humanMap = new Map(humanAnswers.map(a => [a.questionId, a.answer]))
  const agentMap  = new Map(agentAnswers.map(a => [a.questionId, a.answer]))

  const questionScores: QuestionMatchScore[] = []
  let totalWeight = 0
  let totalWeightedScore = 0

  for (const pair of template.pairs) {
    const hAns = humanMap.get(pair.id) ?? ''
    const aAns = agentMap.get(pair.id) ?? ''
    const label = pair.label || pair.id
    let score = 0
    let comment: string | undefined

    if (pair.matchType === 'choice') {
      score = choiceMatchScore(String(hAns), String(aAns))
    } else if (pair.matchType === 'semantic') {
      const result = await semanticMatchScore(String(hAns), String(aAns), label)
      score = result.score
      comment = result.comment
    } else {
      // text / bonus：不参与总分计算，只展示
      score = -1
    }

    questionScores.push({
      id: pair.id,
      label,
      matchType: pair.matchType,
      humanAnswer: String(hAns),
      agentAnswer: String(aAns),
      score,
      comment,
    })

    if (score >= 0) {
      totalWeight += pair.points
      totalWeightedScore += (score / 100) * pair.points
    }
  }

  // 总体匹配度（只计入 choice + semantic，不含 bonus text）
  const overallMatch = totalWeight > 0
    ? Math.round((totalWeightedScore / totalWeight) * 100)
    : 0

  // 找最像/最不同（仅限 choice+semantic）
  const scoredQs = questionScores.filter(q => q.score >= 0)
  const mostSimilar = scoredQs.reduce<QuestionMatchScore | null>(
    (best, q) => (!best || q.score > best.score) ? q : best, null
  )
  const mostDifferent = scoredQs.reduce<QuestionMatchScore | null>(
    (worst, q) => (!worst || q.score < worst.score) ? q : worst, null
  )

  // 提取画像（bonus 题）
  const bonusQ = questionScores.find(q => q.matchType === 'text')
  const humanPortrait = bonusQ ? String(humanMap.get(bonusQ.id) ?? '') : ''
  const agentPortrait  = bonusQ ? String(agentMap.get(bonusQ.id) ?? '') : ''

  // 推荐建议
  let recommendation = ''
  if (mostDifferent && mostDifferent.score <= 30) {
    recommendation = `你们在「${mostDifferent.label}」上差异最大，值得深入探讨。`
  } else if (overallMatch >= 70) {
    recommendation = '你们的想法高度一致，是默契的搭档！'
  } else {
    recommendation = '每一处差异都是了解彼此的机会。'
  }

  return {
    overallMatch,
    questionScores,
    mostSimilar,
    mostDifferent,
    humanPortrait,
    agentPortrait,
    recommendation,
    generatedAt: new Date().toISOString(),
  }
}
