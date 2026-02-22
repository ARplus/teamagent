// 创建一个真实多 Agent 协作测试任务
const http = require('http');

const LOBSTER_TOKEN = 'ta_08b295c6abb43e3a18fa36111f4dde9ba2aa44f9219efb660b12f23970eabeeb';
const INKFISH_TOKEN = 'ta_5ce8949f317cdaaa45d4446a1076acb22bb5f01fb19b3ce84107ada0cd92c205';

function api(token, method, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const opts = {
      hostname: '118.195.138.220', port: 80, path, method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
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
    req.write(data); req.end();
  });
}

async function main() {
  // 1. 获取 Inkfish 的 userId
  const inkfish = await api(INKFISH_TOKEN, 'GET', '/api/agent/status', null);
  console.log('Inkfish 状态:', inkfish.status, inkfish.data?.name, '| userId:', inkfish.data?.userId);
  const inkfishUserId = inkfish.data?.userId || inkfish.data?.id;
  if (!inkfishUserId) { console.log('❌ 获取 Inkfish userId 失败'); return; }

  // 2. 创建测试任务
  console.log('\n创建测试任务...');
  const taskRes = await api(LOBSTER_TOKEN, 'POST', '/api/tasks', {
    title: '🌊 水族军团协作测试',
    description: '测试水族军团真实多 Agent 协作流程。请 Inkfish 写一段简短的中医与 AI 结合的研究意义说明（200字），证明多 Agent 真实执行能力。',
    mode: 'solo'
  });
  console.log('任务创建:', taskRes.status, taskRes.data?.id, taskRes.data?.title);
  if (!taskRes.data?.id) { console.log('❌ 任务创建失败'); return; }
  
  const taskId = taskRes.data.id;

  // 3. 直接创建步骤分配给 Inkfish
  console.log('\n创建步骤分配给 Inkfish...');
  const stepRes = await api(LOBSTER_TOKEN, 'POST', `/api/tasks/${taskId}/steps`, {
    title: '撰写中医+AI研究意义说明',
    description: '请写一段约200字的说明：从学术角度阐述中医传统疗法（经脉点穴）与 AI 效果追踪技术结合的研究意义，以及为何这类研究值得发表在学术期刊上。',
    assigneeId: inkfishUserId,
    requiresApproval: true,
    outputs: ['研究意义说明.md'],
    skills: ['学术写作', '医学内容'],
    stepType: 'task'
  });
  console.log('步骤创建:', stepRes.status, stepRes.data?.id, '| 分配给:', stepRes.data?.assigneeId);

  if (stepRes.data?.id) {
    console.log(`\n✅ 任务 ${taskId} 已创建，步骤 ${stepRes.data.id} 分配给 Inkfish`);
    console.log('等待 Inkfish 认领并执行...');
  }
}

main().catch(console.error);
