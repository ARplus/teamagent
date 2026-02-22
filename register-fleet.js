// 在生产 TeamAgent 注册水族军团
const http = require('http');

const LOBSTER_TOKEN = 'ta_08b295c6abb43e3a18fa36111f4dde9ba2aa44f9219efb660b12f23970eabeeb';

function apiCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const opts = {
      hostname: '118.195.138.220', port: 80, path, method,
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
    req.write(data); req.end();
  });
}

const fleet = [
  {
    name: '🦑 Inkfish',
    email: 'quill@lobster.ai',
    password: 'lobster-agent-2026',
    capabilities: ['写作', '内容创作', '文案策划', '论文写作', '报告撰写', '提纲整理'],
    personality: '文字是我的武器，逻辑是我的盔甲。精于写作、善于表达，让复杂思想变成清晰文字。'
  },
  {
    name: '🦐 Mantis',
    email: 'codereviewer@lobster.ai',
    password: 'lobster-agent-2026',
    capabilities: ['代码审查', '代码编写', '技术分析', '质量保障', '测试'],
    personality: '眼若螳螂，目光如炬。代码中的每个漏洞都逃不过我的双眼。'
  },
  {
    name: '📡 Nautilus',
    email: 'devops@lobster.ai',
    password: 'lobster-agent-2026',
    capabilities: ['运维', '部署', '监控', '系统管理', '服务器配置', '数据库管理'],
    personality: '深海中稳健前行，系统稳定是我的使命。默默运转，让一切井然有序。'
  },
  {
    name: '🐡 PufferQA',
    email: 'testrunner@lobster.ai',
    password: 'lobster-agent-2026',
    capabilities: ['测试', '质量保证', '用户体验测试', '功能验证', 'bug排查'],
    personality: '外表圆滚滚，内心严苛精准。每一个 bug 都是对我的挑战，必须全部找出来。'
  }
];

async function main() {
  console.log('🌊 注册水族军团到生产 TeamAgent...\n');
  const results = [];
  
  for (const agent of fleet) {
    const res = await apiCall('POST', '/api/agents/register', agent);
    if (res.status === 200 || res.status === 201) {
      console.log(`✅ ${agent.name} 注册成功 | token: ${res.data.apiToken?.substring(0, 20)}...`);
      results.push({ name: agent.name, email: agent.email, token: res.data.apiToken, agentId: res.data.agent?.id });
    } else if (res.status === 409) {
      console.log(`⚠️  ${agent.name} 已存在，尝试获取现有 token...`);
      results.push({ name: agent.name, email: agent.email, status: 'exists' });
    } else {
      console.log(`❌ ${agent.name} 注册失败:`, res.status, JSON.stringify(res.data).substring(0, 100));
    }
  }
  
  console.log('\n=== 注册结果 ===');
  results.forEach(r => {
    if (r.token) console.log(`${r.name}: ${r.token}`);
    else console.log(`${r.name}: ${r.status}`);
  });
}

main().catch(console.error);
