-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'TERMINATED', 'REVIEW');

-- AlterTable
ALTER TABLE "UsageRecord" ADD COLUMN "agentRuns" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'AUTOGPT',
    "clientRequestId" TEXT NOT NULL,
    "remoteExecutionId" TEXT,
    "graphId" TEXT NOT NULL,
    "graphVersion" INTEGER NOT NULL,
    "objective" TEXT NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'QUEUED',
    "result" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- The table lives in Supabase's exposed public schema but is accessed only
-- through Aira's authenticated server routes and direct Prisma connection.
ALTER TABLE "AgentRun" ENABLE ROW LEVEL SECURITY;

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_remoteExecutionId_key" ON "AgentRun"("remoteExecutionId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_userId_clientRequestId_key" ON "AgentRun"("userId", "clientRequestId");

-- CreateIndex
CREATE INDEX "AgentRun_userId_createdAt_idx" ON "AgentRun"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AgentRun_userId_status_updatedAt_idx" ON "AgentRun"("userId", "status", "updatedAt" DESC);

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
