const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  const stepId = 'cmlqa8k6e000pi9tghtjo0uoq'
  const userId = 'cmlq8qw7a0004i950cyjmtee2'
  
  // 故意提交一个不完整的结果
  await p.taskStep.update({
    where: { id: stepId },
    data: {
      status: 'waiting_approval',
      agentStatus: 'waiting_approval',
      result: `# 爬虫代码 v1

\`\`\`python
import requests
from bs4 import BeautifulSoup

def scrape_wsj():
    url = "https://www.wsj.com"
    response = requests.get(url)
    # TODO: 解析文章
    pass
\`\`\`

## 进度
- [x] 基础框架
- [ ] 文章解析
- [ ] 数据存储

暂时只有框架，还没跑起来`,
      summary: '爬虫框架完成，但还没有实际抓取数据',
      completedAt: new Date()
    }
  })
  
  await p.agent.update({
    where: { userId },
    data: { status: 'online' }
  })
  
  console.log('✅ 提交了一个不完整的爬虫（等待被打回）')
}

main().finally(() => p.$disconnect())
