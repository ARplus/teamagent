const { PrismaClient } = require('./node_modules/@prisma/client');
const p = new PrismaClient();
const emails = ['quill@lobster.ai', 'codereviewer@lobster.ai', 'devops@lobster.ai', 'testrunner@lobster.ai'];
async function main() {
  for (const email of emails) {
    const u = await p.user.findUnique({ where: { email }, select: { id: true, name: true } });
    console.log(u ? `${u.name}: ${u.id}` : `NOT FOUND: ${email}`);
  }
}
main().catch(console.error).finally(() => p.$disconnect());
