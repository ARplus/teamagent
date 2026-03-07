-- ScheduledTemplate → TaskTemplate (same table, add columns + rename fields)

-- Rename columns
ALTER TABLE "ScheduledTemplate" RENAME COLUMN "title" TO "name";
ALTER TABLE "ScheduledTemplate" RENAME COLUMN "enabled" TO "scheduleEnabled";

-- Make schedule nullable (was required, now optional for manual-only templates)
ALTER TABLE "ScheduledTemplate" ALTER COLUMN "schedule" DROP NOT NULL;

-- Add new columns
ALTER TABLE "ScheduledTemplate" ADD COLUMN "icon" TEXT;
ALTER TABLE "ScheduledTemplate" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'general';
ALTER TABLE "ScheduledTemplate" ADD COLUMN "tags" TEXT;
ALTER TABLE "ScheduledTemplate" ADD COLUMN "variables" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "ScheduledTemplate" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "ScheduledTemplate" ADD COLUMN "defaultMode" TEXT NOT NULL DEFAULT 'solo';
ALTER TABLE "ScheduledTemplate" ADD COLUMN "defaultPriority" TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE "ScheduledTemplate" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ScheduledTemplate" ADD COLUMN "isEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ScheduledTemplate" ADD COLUMN "useCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ScheduledTemplate" ADD COLUMN "lastUsedAt" TIMESTAMP(3);

-- Update indexes (drop old, add new)
DROP INDEX IF EXISTS "ScheduledTemplate_workspaceId_enabled_idx";
DROP INDEX IF EXISTS "ScheduledTemplate_enabled_nextRunAt_idx";
CREATE INDEX "ScheduledTemplate_workspaceId_category_idx" ON "ScheduledTemplate"("workspaceId", "category");
CREATE INDEX "ScheduledTemplate_workspaceId_isEnabled_idx" ON "ScheduledTemplate"("workspaceId", "isEnabled");
CREATE INDEX "ScheduledTemplate_scheduleEnabled_nextRunAt_idx" ON "ScheduledTemplate"("scheduleEnabled", "nextRunAt");

-- Set sourceType for existing templates that came from tasks
UPDATE "ScheduledTemplate" SET "sourceType" = 'from-task' WHERE "sourceTaskId" IS NOT NULL;
