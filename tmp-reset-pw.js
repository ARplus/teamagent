const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
(async () => {
  const prisma = new PrismaClient();
  const hash = await bcrypt.hash('112458', 10);
  await prisma.user.update({ where: { email: 'aurora@arplus.top' }, data: { password: hash } });
  console.log('Password reset OK for aurora@arplus.top');
  await prisma.$disconnect();
})();
