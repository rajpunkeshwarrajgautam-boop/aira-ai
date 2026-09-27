ALTER TABLE "Conversation"
ADD COLUMN "pinnedAt" TIMESTAMP(3);

CREATE INDEX "Conversation_userId_pinnedAt_idx"
ON "Conversation"("userId", "pinnedAt" DESC);
