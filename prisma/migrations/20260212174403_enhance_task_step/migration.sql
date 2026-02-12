-- AlterTable
ALTER TABLE "TaskStep" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "assigneeNames" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "inputs" TEXT,
ADD COLUMN     "outputs" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "skills" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3);
