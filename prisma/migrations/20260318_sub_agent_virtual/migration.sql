-- AlterTable: Add isVirtual column to User for sub-agent virtual users
ALTER TABLE "User" ADD COLUMN "isVirtual" BOOLEAN NOT NULL DEFAULT false;
