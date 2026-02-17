/**
 * AI 自动生成步骤摘要
 * 
 * 根据步骤的结果、附件等信息，生成简洁的摘要
 * 让审核者快速了解工作内容
 */

const QWEN_API_KEY = process.env.QWEN_API_KEY
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

const SUMMARY_PROMPT = `你是 TeamAgent 摘要助手。请根据步骤执行结果，生成一个简洁的摘要。

## 要求
1. 1-2 句话概括完成了什么
2. 突出关键产出物
3. 如果有附件，提及附件数量和类型
4. 语气简洁专业

## 输出格式
直接输出摘要文本，不要 markdown 格式，不要引号包裹。

## 示例
输入: "已完成华尔街日报网站的克隆。使用 HTTrack 工具下载了整站，包括 CSS、JS 和图片资源。网站已部署到本地测试服务器。"
输出: 完成网站克隆，已部署到本地测试服务器，包含完整的静态资源。

输入: "分析了竞品的定价策略，整理成文档。发现他们主要采用订阅制，有三个价格档位。"
输出: 竞品定价分析完成，发现采用三档订阅制模式。`

interface SummaryInput {
  stepTitle: string
  result: string
  attachmentCount?: number
}

export async function generateSummary(input: SummaryInput): Promise<string | null> {
  if (!QWEN_API_KEY) {
    console.log('[Summary] 无 AI Key，跳过摘要生成')
    return null
  }

  // 如果结果太短，直接返回
  if (!input.result || input.result.length < 20) {
    return null
  }

  try {
    const context = `步骤: ${input.stepTitle}
执行结果: ${input.result}
${input.attachmentCount ? `附件数量: ${input.attachmentCount}` : ''}`

    const response = await fetch(QWEN_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${QWEN_API_KEY}`
      },
      body: JSON.stringify({
        model: 'qwen-turbo', // 用快速模型
        messages: [
          { role: 'system', content: SUMMARY_PROMPT },
          { role: 'user', content: context }
        ],
        temperature: 0.3,
        max_tokens: 100
      })
    })

    if (!response.ok) {
      console.error('[Summary] AI 调用失败')
      return null
    }

    const data = await response.json()
    const summary = data.choices?.[0]?.message?.content?.trim()

    if (summary) {
      console.log(`[Summary] 生成摘要: ${summary}`)
      return summary
    }

    return null

  } catch (error) {
    console.error('[Summary] 生成失败:', error)
    return null
  }
}
