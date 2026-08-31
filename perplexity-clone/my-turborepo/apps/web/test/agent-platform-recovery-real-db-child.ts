import { prisma } from "@/lib/prisma";
import { reconcileBlockedManagedTask } from "@/lib/agent-platform/recovery";

const [userId, runId, taskId] = process.argv.slice(2);

if (!userId || !runId || !taskId) {
	console.error("usage: agent-platform-recovery-real-db-child.ts <userId> <runId> <taskId>");
	process.exitCode = 2;
} else {
	try {
		const result = await reconcileBlockedManagedTask({ userId, runId, taskId });
		console.log(JSON.stringify(result));
	} catch (error) {
		console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
		process.exitCode = 1;
	} finally {
		await prisma.$disconnect().catch(() => undefined);
	}
}
