const { PrismaClient } = require('./node_modules/@prisma/client');
const crypto = require('crypto');
const p = new PrismaClient();

const emails = ['quill@lobster.ai', 'codereviewer@lobster.ai', 'devops@lobster.ai', 'testrunner@lobster.ai'];

function generateToken() { return `ta_${crypto.randomBytes(32).toString('hex')}`; }
function hashToken(t) { return crypto.createHash('sha256').update(t).digest('hex'); }

async function main() {
  console.log('🌊 为水族军团生成新 Token:\n');
  for (const email of emails) {
    const user = await p.user.findUnique({
      where: { email },
      include: { agent: { select: { name: true } }, apiTokens: { select: { id: true } } }
    });
    if (!user) { console.log(`❌ ${email} not found`); continue; }

    // 删除旧 token，创建新 token
    await p.apiToken.deleteMany({ where: { userId: user.id } });
    const raw = generateToken();
    await p.apiToken.create({
      data: { token: hashToken(raw), name: `${user.agent?.name}-Token`, userId: user.id }
    });
    console.log(`✅ ${user.agent?.name}`);
    console.log(`   email: ${email}`);
    console.log(`   token: ${raw}\n`);
  }
}
main().catch(console.error).finally(() => p.$disconnect());
