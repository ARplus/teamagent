-- AddColumn: User.lastSeenAt — 用户最后在线时间（心跳更新）
ALTER TABLE "User" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
