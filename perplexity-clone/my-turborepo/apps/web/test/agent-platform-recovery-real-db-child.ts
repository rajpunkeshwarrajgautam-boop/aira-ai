import { reconcileBlockedManagedTask } from "@/lib/agent-platform/recovery";

const [userId, runId, taskId] = process.argv.slice(2);

function finish(stream: NodeJS.WriteStream, body: string, code: number): void {
	stream.write(`${body}\n`, () => process.exit(code));
}

if (!userId || !runId || !taskId) {
	finish(process.stderr, "usage: agent-platform-recovery-real-db-child.ts <userId> <runId> <taskId>", 2);
} else {
	try {
		const result = await reconcileBlockedManagedTask({ userId, runId, taskId });
		// Prisma uses an externally-owned pg Pool in this application. A short-lived
		// restart probe must terminate after its durable result is flushed rather
		// than waiting for that pool's normal idle timeout.
		finish(process.stdout, JSON.stringify(result), 0);
	} catch (error) {
		finish(
			process.stderr,
			error instanceof Error ? `${error.name}: ${error.message}` : String(error),
			1,
		);
	}
}
