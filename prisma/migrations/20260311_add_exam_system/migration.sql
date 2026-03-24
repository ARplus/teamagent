-- AlterTable: TaskTemplate 新增考试字段
ALTER TABLE "ScheduledTemplate" ADD COLUMN "examTemplate" TEXT;
ALTER TABLE "ScheduledTemplate" ADD COLUMN "examPassScore" INTEGER NOT NULL DEFAULT 60;

-- CreateTable: ExamSubmission
CREATE TABLE "ExamSubmission" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "answers" TEXT NOT NULL,
    "autoScore" INTEGER,
    "manualScore" INTEGER,
    "totalScore" INTEGER,
    "maxScore" INTEGER NOT NULL DEFAULT 100,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "gradingStatus" TEXT NOT NULL DEFAULT 'pending',
    "gradedBy" TEXT,
    "gradingNote" TEXT,
    "complaintText" TEXT,
    "complaintStatus" TEXT,
    "complaintNote" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExamSubmission_enrollmentId_key" ON "ExamSubmission"("enrollmentId");
CREATE INDEX "ExamSubmission_userId_idx" ON "ExamSubmission"("userId");
CREATE INDEX "ExamSubmission_templateId_idx" ON "ExamSubmission"("templateId");
CREATE INDEX "ExamSubmission_gradingStatus_idx" ON "ExamSubmission"("gradingStatus");

-- AddForeignKey
ALTER TABLE "ExamSubmission" ADD CONSTRAINT "ExamSubmission_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "CourseEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamSubmission" ADD CONSTRAINT "ExamSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamSubmission" ADD CONSTRAINT "ExamSubmission_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ScheduledTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
