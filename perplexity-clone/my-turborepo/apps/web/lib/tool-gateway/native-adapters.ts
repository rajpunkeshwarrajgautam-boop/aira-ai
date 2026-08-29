import { z } from "zod";

import {
	deleteProjectMemory,
	listProjectMemory,
	rememberProjectFact,
	retrieveProjectMemory,
	type ProjectMemoryKind,
} from "@/lib/agent-platform/project-memory";
import { getWorktreeForUser } from "@/lib/agent-platform/worktrees";
import { runRemoteCommand, terminalRuntimeHealth } from "@/lib/terminal-runtime/client";
import { createExaSearchService } from "@services/search";

import type { ToolAdapter } from "./types";
import { ToolGatewayError } from "./types";

const WorkspacePathSchema = z.object({
	workspaceId: z.string().min(8).max(128),
	path: z.string().min(1).max(1024),
});
const FileWriteSchema = WorkspacePathSchema.extend({ content: z.string().max(512_000) });
const FileMoveSchema = z.object({
	workspaceId: z.string().min(8).max(128),
	from: z.string().min(1).max(1024),
	to: z.string().min(1).max(1024),
});
const FileSearchSchema = z.object({
	workspaceId: z.string().min(8).max(128),
	query: z.string().min(1).max(500),
	path: z.string().max(1024).optional(),
	limit: z.number().int().min(1).max(100).default(40),
});

const MemoryKinds = [
	"GOAL",
	"ARCHITECTURE",
	"TECH_STACK",
	"CONSTRAINT",
	"ARTIFACT",
	"DEPLOYMENT",
	"BLOCKER",
	"DECISION",
	"VERIFICATION",
	"OTHER",
] as const;
const MemoryWriteSchema = z.object({
	memoryKey: z.string().trim().min(1).max(180),
	kind: z.enum(MemoryKinds).default("OTHER"),
	content: z.string().trim().min(1).max(20_000),
	importance: z.number().int().min(1).max(5).optional(),
	confidence: z.number().min(0).max(1).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});
const MemorySearchSchema = z.object({
	query: z.string().min(1).max(4_000),
	limit: z.number().int().min(1).max(12).default(8),
});
const MemoryReadSchema = z.object({ limit: z.number().int().min(1).max(100).default(40) });
const MemoryDeleteSchema = z.object({ memoryKey: z.string().trim().min(1).max(180) });

const WebSearchSchema = z.object({
	query: z.string().trim().min(1).max(4_000),
	numResults: z.number().int().min(1).max(10).default(6),
	includeDomains: z.array(z.string().trim().min(1).max(255)).max(10).optional(),
	excludeDomains: z.array(z.string().trim().min(1).max(255)).max(10).optional(),
});
const WebOpenSchema = z.object({ url: z.string().url().max(4_096) });

const SAFE_FILE_SCRIPT = String.raw`
import base64,json,os,pathlib,shutil,sys
root=pathlib.Path.cwd().resolve()
def rel(raw):
 p=pathlib.Path(raw)
 if p.is_absolute() or '..' in p.parts or '.git' in p.parts or '\x00' in raw: raise ValueError('unsafe path')
 q=(root/p).resolve()
 q.relative_to(root)
 return q
op=sys.argv[1]
if op=='read':
 q=rel(sys.argv[2])
 if not q.is_file() or q.is_symlink(): raise ValueError('file unavailable')
 if q.stat().st_size>524288: raise ValueError('file too large')
 print(json.dumps({'path':sys.argv[2],'content':q.read_text(encoding='utf-8'),'bytes':q.stat().st_size}))
elif op=='write':
 q=rel(sys.argv[2]); data=base64.b64decode(sys.argv[3],validate=True)
 if len(data)>524288: raise ValueError('file too large')
 try: data.decode('utf-8')
 except UnicodeDecodeError: raise ValueError('text files only')
 if q.exists() and q.is_symlink(): raise ValueError('symlink writes blocked')
 q.parent.mkdir(parents=True,exist_ok=True); q.write_bytes(data)
 print(json.dumps({'path':sys.argv[2],'bytes':len(data),'written':True}))
elif op=='move':
 src=rel(sys.argv[2]); dst=rel(sys.argv[3])
 if not src.is_file() or src.is_symlink() or (dst.exists() and dst.is_symlink()): raise ValueError('file unavailable')
 dst.parent.mkdir(parents=True,exist_ok=True); src.replace(dst)
 print(json.dumps({'from':sys.argv[2],'to':sys.argv[3],'moved':True}))
elif op=='delete':
 q=rel(sys.argv[2])
 if not q.is_file() or q.is_symlink(): raise ValueError('file unavailable')
 q.unlink(); print(json.dumps({'path':sys.argv[2],'deleted':True}))
elif op=='search':
 base=rel(sys.argv[2] or '.'); needle=sys.argv[3].lower(); limit=min(100,max(1,int(sys.argv[4]))); out=[]
 if not base.is_dir(): raise ValueError('search root unavailable')
 for dp,dn,fn in os.walk(base,followlinks=False):
  dn[:]=[d for d in dn if d not in {'.git','node_modules','.next','dist','build'} and not (pathlib.Path(dp)/d).is_symlink()]
  for name in fn:
   p=pathlib.Path(dp)/name
   try:
    if p.is_symlink() or p.stat().st_size>262144: continue
    text=p.read_text(encoding='utf-8')
   except (OSError,UnicodeDecodeError): continue
   for i,line in enumerate(text.splitlines(),1):
    if needle in line.lower():
     out.append({'path':str(p.relative_to(root)),'line':i,'text':line[:500]})
     if len(out)>=limit: print(json.dumps({'matches':out,'truncated':True})); raise SystemExit(0)
 print(json.dumps({'matches':out,'truncated':False}))
else: raise ValueError('unsupported operation')
`;

function invalid(message: string): never {
	throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message, status: 400 });
}

async function ownedWorkspace(userId: string, runId: string, workspaceId: string): Promise<void> {
	const workspace = await getWorktreeForUser(userId, workspaceId);
	if (!workspace || workspace.runId !== runId) {
		throw new ToolGatewayError({ code: "WORKTREE_NOT_FOUND", message: "Workspace is outside this mission scope.", status: 404 });
	}
}

function parseWorkerJson(stdout: string): Record<string, unknown> {
	try {
		const value = JSON.parse(stdout.trim()) as unknown;
		if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
	} catch {
		// handled below
	}
	throw new ToolGatewayError({ code: "FILE_WORKER_RESPONSE_INVALID", message: "The isolated workspace returned an invalid file result.", status: 502 });
}

async function fileOperation(workspaceId: string, args: readonly string[]): Promise<Record<string, unknown>> {
	const result = await runRemoteCommand({
		workspaceId,
		argv: ["python3", "-c", SAFE_FILE_SCRIPT, ...args],
		timeoutSeconds: 30,
	});
	if (result.exitCode !== 0) {
		throw new ToolGatewayError({ code: "FILE_OPERATION_FAILED", message: "The isolated workspace rejected the file operation.", status: 422 });
	}
	return parseWorkerJson(result.stdout);
}

function serializeMemory(memory: Awaited<ReturnType<typeof listProjectMemory>>[number]): Record<string, unknown> {
	return {
		id: memory.id,
		memoryKey: memory.memoryKey,
		kind: memory.kind,
		content: memory.content,
		source: memory.source,
		importance: memory.importance,
		confidence: memory.confidence,
		metadata: memory.metadata,
		createdAt: memory.createdAt.toISOString(),
		updatedAt: memory.updatedAt.toISOString(),
	};
}

export const filesToolAdapter: ToolAdapter = {
	id: "files",
	isAvailable: terminalRuntimeHealth,
	async execute(context, action, input) {
		if (action === "read" || action === "delete") {
			const parsed = WorkspacePathSchema.safeParse(input);
			if (!parsed.success) invalid("File input is invalid.");
			await ownedWorkspace(context.userId, context.runId, parsed.data.workspaceId);
			return { result: await fileOperation(parsed.data.workspaceId, [action, parsed.data.path]) };
		}
		if (action === "write") {
			const parsed = FileWriteSchema.safeParse(input);
			if (!parsed.success) invalid("File write input is invalid.");
			await ownedWorkspace(context.userId, context.runId, parsed.data.workspaceId);
			return { result: await fileOperation(parsed.data.workspaceId, ["write", parsed.data.path, Buffer.from(parsed.data.content, "utf8").toString("base64")]) };
		}
		if (action === "move") {
			const parsed = FileMoveSchema.safeParse(input);
			if (!parsed.success) invalid("File move input is invalid.");
			await ownedWorkspace(context.userId, context.runId, parsed.data.workspaceId);
			return { result: await fileOperation(parsed.data.workspaceId, ["move", parsed.data.from, parsed.data.to]) };
		}
		if (action === "search") {
			const parsed = FileSearchSchema.safeParse(input);
			if (!parsed.success) invalid("File search input is invalid.");
			await ownedWorkspace(context.userId, context.runId, parsed.data.workspaceId);
			return { result: await fileOperation(parsed.data.workspaceId, ["search", parsed.data.path ?? ".", parsed.data.query, String(parsed.data.limit)]) };
		}
		throw new ToolGatewayError({ code: "TOOL_ACTION_UNSUPPORTED", message: `Files action ${action} is not supported.`, status: 409 });
	},
};

export const memoryToolAdapter: ToolAdapter = {
	id: "memory",
	async isAvailable() { return true; },
	async execute(context, action, input) {
		if (action === "read") {
			const parsed = MemoryReadSchema.safeParse(input);
			if (!parsed.success) invalid("Memory read input is invalid.");
			const memories = await listProjectMemory(context.userId, context.projectId, parsed.data.limit);
			return { result: { memories: memories.map(serializeMemory) } };
		}
		if (action === "search") {
			const parsed = MemorySearchSchema.safeParse(input);
			if (!parsed.success) invalid("Memory search input is invalid.");
			const memories = await retrieveProjectMemory({ userId: context.userId, projectId: context.projectId, query: parsed.data.query, limit: parsed.data.limit });
			return { result: { memories: memories.map(serializeMemory) } };
		}
		if (action === "write") {
			const parsed = MemoryWriteSchema.safeParse(input);
			if (!parsed.success) invalid("Memory write input is invalid.");
			await rememberProjectFact({
				userId: context.userId,
				projectId: context.projectId,
				memoryKey: parsed.data.memoryKey,
				kind: parsed.data.kind as ProjectMemoryKind,
				content: parsed.data.content,
				source: `tool-gateway:${context.runId}:${context.taskId ?? "manager"}`,
				importance: parsed.data.importance,
				confidence: parsed.data.confidence,
				metadata: parsed.data.metadata,
			});
			return { result: { memoryKey: parsed.data.memoryKey, stored: true } };
		}
		if (action === "delete") {
			const parsed = MemoryDeleteSchema.safeParse(input);
			if (!parsed.success) invalid("Memory delete input is invalid.");
			return { result: { memoryKey: parsed.data.memoryKey, deleted: await deleteProjectMemory({ userId: context.userId, projectId: context.projectId, memoryKey: parsed.data.memoryKey }) } };
		}
		throw new ToolGatewayError({ code: "TOOL_ACTION_UNSUPPORTED", message: `Memory action ${action} is not supported.`, status: 409 });
	},
};

export const webToolAdapter: ToolAdapter = {
	id: "web",
	async isAvailable() { return Boolean(process.env.EXA_API_KEY?.trim()); },
	async execute(_context, action, input) {
		const service = createExaSearchService();
		if (action === "search" || action === "retrieve") {
			const parsed = WebSearchSchema.safeParse(input);
			if (!parsed.success) invalid("Web search input is invalid.");
			const search = await service.search(parsed.data.query, {
				numResults: parsed.data.numResults,
				includeDomains: parsed.data.includeDomains,
				excludeDomains: parsed.data.excludeDomains,
				contents: { textMaxCharacters: 3_500, highlightMaxCharacters: 1_800, highlightQuery: parsed.data.query },
			});
			return { result: {
				requestId: search.requestId,
				searchType: search.searchType,
				sources: search.candidates.slice(0, parsed.data.numResults).map((source) => ({
					url: source.url,
					title: source.title,
					publishedDate: source.publishedDate,
					excerpt: source.excerpt.slice(0, 3_500),
				})),
			} };
		}
		if (action === "open") {
			const parsed = WebOpenSchema.safeParse(input);
			if (!parsed.success) invalid("Web open input is invalid.");
			const url = new URL(parsed.data.url);
			if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) invalid("Only credential-free HTTP(S) URLs can be retrieved.");
			const search = await service.search(parsed.data.url, {
				numResults: 3,
				includeDomains: [url.hostname],
				contents: { textMaxCharacters: 6_000, highlightMaxCharacters: 3_000, highlightQuery: parsed.data.url },
			});
			const exact = search.candidates.find((source) => source.url === parsed.data.url) ?? search.candidates[0];
			if (!exact) throw new ToolGatewayError({ code: "WEB_RESOURCE_NOT_FOUND", message: "The web retrieval provider returned no public result for this URL.", status: 404 });
			return { result: { url: exact.url, title: exact.title, publishedDate: exact.publishedDate, excerpt: exact.excerpt.slice(0, 6_000), provider: "exa" } };
		}
		throw new ToolGatewayError({ code: "TOOL_ACTION_UNSUPPORTED", message: `Web action ${action} is not supported.`, status: 409 });
	},
};
