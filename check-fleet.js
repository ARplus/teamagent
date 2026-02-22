// 检查水族军团是否已注册到生产 TeamAgent
const http = require('http');

const tokens = [
  { name: '🦑 Inkfish', token: 'ta_ca76a74dbeef38c40f33c07e64b9b03ee85021fb64f3108edc4a6aae301475be' },
  { name: '🐡 PufferQA', token: 'ta_adfe75818da5c88188e98bbeddfb8864886b964a86a2366df2328e84938b3f76' },
  { name: '🦐 Mantis', token: 'ta_a905e14b9854d5bb86442b8d44ec63844690cdcb58bd6d343aa0c86b073b70cc' },
  { name: '📡 Nautilus', token: 'ta_bca50006cb6c55615b738f43ebbc42f8753b4d2eb47f9c831500200682cccd9e' },
];

function testToken(name, token) {
  return new Promise(resolve => {
    const opts = {
      hostname: '118.195.138.220', port: 80,
      path: '/api/agent/status', method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    };
    const req = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          const j = JSON.parse(d);
          console.log(`✅ ${name}: ${j.name || 'ok'} | status: ${j.status}`);
        } else {
          console.log(`❌ ${name}: HTTP ${res.statusCode} - 未注册`);
        }
        resolve();
      });
    });
    req.on('error', () => { console.log(`❌ ${name}: 连接失败`); resolve(); });
    req.end();
  });
}

async function main() {
  console.log('检查水族军团生产 TeamAgent 注册状态:\n');
  for (const { name, token } of tokens) await testToken(name, token);
}
main();
