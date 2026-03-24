-- V1.1 Template Execution: Step expansion, human input, unassigned, uploaderType, SkillRegistry

-- TaskStep: 步骤展开（子步骤机制）
ALTER TABLE "TaskStep" ADD COLUMN "parentStepId" TEXT;
ALTER TABLE "TaskStep" ADD CONSTRAINT "TaskStep_parentStepId_fkey"
  FOREIGN KEY ("parentStepId") REFERENCES "TaskStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "TaskStep_parentStepId_idx" ON "TaskStep"("parentStepId");

-- TaskStep: 人类资料补充
ALTER TABLE "TaskStep" ADD COLUMN "needsHumanInput" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TaskStep" ADD COLUMN "humanInputPrompt" TEXT;
ALTER TABLE "TaskStep" ADD COLUMN "humanInputStatus" TEXT DEFAULT 'not_needed';

-- TaskStep: 未分配步骤
ALTER TABLE "TaskStep" ADD COLUMN "unassigned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TaskStep" ADD COLUMN "unassignedReason" TEXT;

-- Attachment: 上传者类型
ALTER TABLE "Attachment" ADD COLUMN "uploaderType" TEXT;

-- SkillRegistry: Skill 注册表
CREATE TABLE "SkillRegistry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "clawhubPackage" TEXT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "requiresKey" BOOLEAN NOT NULL DEFAULT false,
    "keySetupGuide" TEXT,
    "alternatives" TEXT,
    "recommended" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillRegistry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SkillRegistry_name_key" ON "SkillRegistry"("name");
CREATE INDEX "SkillRegistry_category_idx" ON "SkillRegistry"("category");
