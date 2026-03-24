-- Add difficulty field to TaskTemplate (courses)
-- difficulty: beginner | intermediate | advanced
ALTER TABLE "ScheduledTemplate" ADD COLUMN IF NOT EXISTS "difficulty" TEXT;

-- Migrate existing level values from category to difficulty
-- (category was previously misused to store level data)
UPDATE "ScheduledTemplate"
SET difficulty = CASE category
  WHEN 'professional' THEN 'advanced'
  ELSE category
END
WHERE category IN ('beginner', 'intermediate', 'professional', 'advanced');

-- Reset those category values back to 'general'
UPDATE "ScheduledTemplate"
SET category = 'general'
WHERE category IN ('beginner', 'intermediate', 'professional');
