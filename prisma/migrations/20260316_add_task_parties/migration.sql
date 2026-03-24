-- AddColumn: Task.parties (多方参与配置)
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "parties" JSONB;
