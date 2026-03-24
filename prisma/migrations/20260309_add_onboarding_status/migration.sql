-- AlterTable: Add onboardingStatus to Agent
ALTER TABLE "Agent" ADD COLUMN "onboardingStatus" TEXT NOT NULL DEFAULT 'graduated';
