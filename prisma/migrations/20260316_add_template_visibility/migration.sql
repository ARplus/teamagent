-- AddColumn: TaskTemplate.visibility (三级可见性)
ALTER TABLE "TaskTemplate" ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'workspace';

-- 数据迁移: isPublic=true → 'public', isPublic=false → 'workspace'
UPDATE "TaskTemplate" SET "visibility" = CASE
  WHEN "isPublic" = true THEN 'public'
  ELSE 'workspace'
END;
