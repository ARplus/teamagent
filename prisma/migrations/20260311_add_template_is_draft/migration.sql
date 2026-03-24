-- AlterTable: Add isDraft column to ScheduledTemplate
ALTER TABLE "ScheduledTemplate" ADD COLUMN "isDraft" BOOLEAN NOT NULL DEFAULT false;
