const { PrismaClient } = require('./node_modules/@prisma/client');
const crypto = require('crypto');
const p = new PrismaClient();

// 水族军团邮箱
const emails = ['quill@lobster.ai', 'codereviewer@lobster.ai', 'devops@lobster.ai', 'testrunner@lobster.ai'];

async function main() {
  for (const email of emails) {
    const user = await p.user.findUnique({
      where: { email },
      include: {
        agent: { select: { name: true, capabilities: true, isMainAgent: true } },
        apiTokens: { select: { token: true, name: true }, orderBy: { createdAt: 'desc' }, take: 1 }
      }
    });
    if (!user) { console.log(`❌ ${email} not found`); continue; }
    
    const tokenHash = user.apiTokens[0]?.token;
    console.log(`\n${user.agent?.name} (${email})`);
    console.log(`  userId: ${user.id}`);
    console.log(`  agentId: N/A (fetch separately)`);
    console.log(`  tokenHash: ${tokenHash?.substring(0, 20)}... (hashed, cannot recover raw)`);
    console.log(`  capabilities: ${user.agent?.capabilities}`);
  }
}
main().catch(console.error).finally(() => p.$disconnect());
