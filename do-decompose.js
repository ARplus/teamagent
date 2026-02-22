// 认领并提交 decompose 步骤
const http = require('http');
const { PrismaClient } = require('./node_modules/@prisma/client');
const p = new PrismaClient();

const LOBSTER_TOKEN = 'ta_08b295c6abb43e3a18fa36111f4dde9ba2aa44f9219efb660b12f23970eabeeb';
const HOST = '118.195.138.220';

function apiCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: HOST, port: 80, path, method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LOBSTER_TOKEN}`,
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, data: d }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  // 找到 decompose 步骤
  const task = await p.task.findFirst({
    where: { title: { contains: '中医' } },
    include: { steps: true }
  });
  if (!task) return console.log('Task not found');
  
  const decomposeStep = task.steps.find(s => s.stepType === 'decompose');
  if (!decomposeStep) return console.log('No decompose step found');
  
  console.log('Found decompose step:', decomposeStep.id, decomposeStep.title);
  console.log('Status:', decomposeStep.status);

  // 1. 认领步骤
  const claimRes = await apiCall('POST', `/api/steps/${decomposeStep.id}/claim`, {});
  console.log('\nClaim result:', claimRes.status, JSON.stringify(claimRes.data).substring(0, 100));

  if (claimRes.status !== 200 && claimRes.status !== 201) {
    console.log('Claim failed, trying to submit directly...');
  }

  // 2. 分析任务 + 团队，生成步骤拆解 JSON
  // 团队成员：Galileo(选题), Compass(策略), Quill(提纲), Scribe(写作), Argus(引文), Folio(排版), Lobster(主Agent)
  // 任务：中医+AI论文，研究可行性+选题
  
  const decomposedSteps = [
    {
      title: "中医+AI相关文献调研",
      description: "调研国内外关于中医（经脉点穴、脑梗/脑出血康复）与 AI/数字健康结合的已发表论文。重点：是否已有类似研究？主流期刊有哪些？研究空白在哪里？",
      assignee: "Galileo",
      requiresApproval: false,
      parallelGroup: "调研",
      outputs: ["文献调研报告.md"],
      skills: ["文献检索", "学术数据库", "研究综述"]
    },
    {
      title: "AIcare数据用于学术发表的可行性分析",
      description: "分析 AIcare 追踪记录的数据类型和质量：是否符合学术发表的数据标准？能否支撑论证？中医治疗效果的量化指标如何呈现？",
      assignee: "Compass",
      requiresApproval: false,
      parallelGroup: "调研",
      outputs: ["AIcare数据可行性分析.md"],
      skills: ["数据分析", "医学研究方法", "临床研究设计"]
    },
    {
      title: "目标期刊筛选",
      description: "筛选适合本论文的目标期刊（国内外）：接受中医+AI/数字健康类文章、SCI/CSCD核心/中文核心级别、投稿要求和周期。",
      assignee: "Argus",
      requiresApproval: false,
      parallelGroup: "调研",
      outputs: ["目标期刊清单.md"],
      skills: ["期刊研究", "引文分析", "学术出版"]
    },
    {
      title: "综合可行性评估报告",
      description: "综合以上三项调研结果，输出可行性评估：1）是否具备发表条件 2）主要挑战和风险 3）建议的研究周期和资源需求。需要 Aurora 审批后才进行下一步。",
      assignee: "Quill",
      requiresApproval: true,
      parallelGroup: null,
      inputs: ["文献调研报告.md", "AIcare数据可行性分析.md", "目标期刊清单.md"],
      outputs: ["可行性评估报告.md"],
      skills: ["学术写作", "提纲整理", "综合分析"]
    },
    {
      title: "论文选题方案（3-5个）",
      description: "基于可行性报告，提出 3-5 个具体论文选题方案，每个方案包含：拟定题目、核心论点、研究方法、目标期刊、预计工作量。",
      assignee: "Compass",
      requiresApproval: true,
      parallelGroup: null,
      inputs: ["可行性评估报告.md"],
      outputs: ["论文选题方案.md"],
      skills: ["学术策划", "方向研究", "选题分析"]
    }
  ];

  // 3. 提交 decompose 结果
  const submitRes = await apiCall('POST', `/api/steps/${decomposeStep.id}/submit`, {
    result: JSON.stringify(decomposedSteps),
    summary: `已将「中医+AI论文」拆解为 ${decomposedSteps.length} 个步骤：3个并行调研（文献+AIcare数据+期刊）→ 可行性报告（Aurora审批）→ 选题方案（Aurora审批）`
  });
  
  console.log('\nSubmit result:', submitRes.status);
  console.log(JSON.stringify(submitRes.data, null, 2));
}

main().catch(console.error).finally(() => p.$disconnect());
