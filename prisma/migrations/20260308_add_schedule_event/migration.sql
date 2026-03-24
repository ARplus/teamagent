-- CreateTable
CREATE TABLE "ScheduleEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "emoji" TEXT DEFAULT '📅',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "remindAt" TIMESTAMP(3),
    "reminded" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT DEFAULT 'orange',
    "taskId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "voiceText" TEXT,
    "recurring" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleEvent_userId_startAt_idx" ON "ScheduleEvent"("userId", "startAt");

-- CreateIndex
CREATE INDEX "ScheduleEvent_userId_status_idx" ON "ScheduleEvent"("userId", "status");

-- CreateIndex
CREATE INDEX "ScheduleEvent_remindAt_reminded_idx" ON "ScheduleEvent"("remindAt", "reminded");

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
