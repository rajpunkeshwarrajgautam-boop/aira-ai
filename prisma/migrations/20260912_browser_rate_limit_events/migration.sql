-- CreateTable
CREATE TABLE IF NOT EXISTS "BrowserRateLimitEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrowserRateLimitEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BrowserRateLimitEvent_userId_type_createdAt_idx"
    ON "BrowserRateLimitEvent"("userId", "type", "createdAt" DESC);
