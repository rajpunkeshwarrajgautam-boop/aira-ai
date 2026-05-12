-- CreateTable
CREATE TABLE "ProductAnalyticsEvent" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "surface" TEXT,
    "userType" TEXT,
    "queryLength" INTEGER,
    "sourceCount" INTEGER,
    "citationCount" INTEGER,
    "citationIndex" INTEGER,
    "sourceDomain" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductAnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductAnalyticsEvent_createdAt_idx" ON "ProductAnalyticsEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ProductAnalyticsEvent_event_createdAt_idx" ON "ProductAnalyticsEvent"("event", "createdAt");

-- CreateIndex
CREATE INDEX "ProductAnalyticsEvent_userType_createdAt_idx" ON "ProductAnalyticsEvent"("userType", "createdAt");

-- CreateIndex
CREATE INDEX "ProductAnalyticsEvent_surface_createdAt_idx" ON "ProductAnalyticsEvent"("surface", "createdAt");
