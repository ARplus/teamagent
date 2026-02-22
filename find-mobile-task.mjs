import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const tasks = await prisma.task.findMany({
    include: { steps: { orderBy: { order: 'asc' } } }
  });
  
  for (const task of tasks) {
    console.log(`\n=== Task: ${task.title} (${task.id}) ===`);
    console.log(`Mode: ${task.mode}, Status: ${task.status}`);
    for (const step of task.steps) {
      console.log(`  Step ${step.order}: [${step.status}] ${step.title} - assignee: ${step.assigneeId || 'none'}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
