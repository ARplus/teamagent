const { PrismaClient } = require('/root/teamagent/node_modules/@prisma/client');
const p = new PrismaClient();
p.scheduledTemplate.findMany({
  where: { courseType: { not: null } },
  orderBy: { createdAt: 'asc' }
}).then(courses => {
  const result = courses.map(c => ({
    id: c.id,
    name: c.name,
    description: c.description,
    icon: c.icon,
    courseType: c.courseType,
    category: c.category,
    difficulty: c.difficulty,
    department: c.department,
    school: c.school,
    tags: c.tags,
    price: c.price,
    coverImage: c.coverImage,
    reviewStatus: c.reviewStatus,
    isPublic: c.isPublic,
    isDraft: c.isDraft,
    creatorId: c.creatorId,
    workspaceId: c.workspaceId,
    stepsTemplate: (() => { try { return JSON.parse(c.stepsTemplate); } catch(e) { return c.stepsTemplate; } })(),
    principleTemplate: c.principleTemplate,
    examTemplate: (() => { try { return JSON.parse(c.examTemplate); } catch(e) { return c.examTemplate; } })(),
    examPassScore: c.examPassScore,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
