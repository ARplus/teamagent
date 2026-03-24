-- Add partyRole to TaskStep (Team template multi-party binding)
ALTER TABLE "TaskStep" ADD COLUMN IF NOT EXISTS "partyRole" TEXT;

-- Add partyRole to InviteToken (Team template invite carries party role)
ALTER TABLE "InviteToken" ADD COLUMN IF NOT EXISTS "partyRole" TEXT;
