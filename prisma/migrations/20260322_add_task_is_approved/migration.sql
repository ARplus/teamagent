-- Add isApproved to Task: approval gate state (default true = no restriction)
ALTER TABLE "Task" ADD COLUMN "isApproved" BOOLEAN NOT NULL DEFAULT TRUE;

-- Add requiresApprovalGate to TaskTemplate: explicit opt-in for approval flow
ALTER TABLE "TaskTemplate" ADD COLUMN "requiresApprovalGate" BOOLEAN NOT NULL DEFAULT FALSE;
