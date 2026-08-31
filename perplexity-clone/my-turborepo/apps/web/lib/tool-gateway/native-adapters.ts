import { z } from "zod";

import {
	deleteProjectMemory,
	listProjectMemory,
	rememberProjectFact,
	retrieveProjectMemory,
	type ProjectMemoryKind,
} from "@/lib/agent-platform/project-memory";
import { getScopedWorktree } from "@/lib/agent-platform/worktrees";
import { runRemoteCommand, terminalRuntimeHealth } from "@/lib/terminal-runtime/client";
import { createExaSearchService } from "@services/search";

import type { ToolAdapter, ToolContext } from "./types";
import { ToolGatewayError } from "./types";
import {
	publicWebUrl,
	UNTRUSTED_WEB_CONTENT,
	webSourceMatchesRequestedTarget,
} from "./web-security";

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
import base64,json,os,pathlib,stat,sys
root=pathlib.Path.cwd().resolve()
O_NOFOLLOW=getattr(os,'O_NOFOLLOW',0)
O_DIRECTORY=getattr(os,'O_DIRECTORY',0)
SKIP={'.git','node_modules','.next','dist','build'}
def parts(raw,allow_root=False):
 if '\x00' in raw: raise ValueError('unsafe path')
 normalized=raw.replace('\\','/')
 if normalized.startswith('//') or (len(normalized)>=2 and normalized[0].isalpha() and normalized[1]==':'): raise ValueError('unsafe path')
 p=pathlib.PurePosixPath(normalized)
 if p.is_absolute(): raise ValueError('unsafe path')
 out=[part for part in p.parts if part not in {'','.'}]
 if any(part in {'..','.git'} for part in out): raise ValueError('unsafe path')
 if not out and not allow_root: raise ValueError('unsafe path')
 return out
def open_dir(path_parts,create=False):
 fd=os.open(str(root),os.O_RDONLY|O_DIRECTORY)
 try:
  for part in path_parts:
   try: child=os.open(part,os.O_RDONLY|O_DIRECTORY|O_NOFOLLOW,dir_fd=fd)
   except FileNotFoundError:
    if not create: raise
    os.mkdir(part,0o755,dir_fd=fd)
    child=os.open(part,os.O_RDONLY|O_DIRECTORY|O_NOFOLLOW,dir_fd=fd)
   os.close(fd); fd=child
  return fd
 except:
  os.close(fd); raise
def parent_leaf(raw,create=False):
 ps=parts(raw)
 return open_dir(ps[:-1],create),ps[-1]
def regular(fd,max_size):
 st=os.fstat(fd)
 if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1: raise ValueError('file unavailable')
 if st.st_size>max_size: raise ValueError('file too large')
 return st
def read_all(fd,limit):
 chunks=[]; total=0
 while total<=limit:
  chunk=os.read(fd,min(65536,limit-total+1))
  if not chunk: break
  chunks.append(chunk); total+=len(chunk)
 if total>limit: raise ValueError('file too large')
 return b''.join(chunks)
op=sys.argv[1]
if op=='read':
 pfd,name=parent_leaf(sys.argv[2])
 try:
  fd=os.open(name,os.O_RDONLY|O_NOFOLLOW,dir_fd=pfd)
  try:
   st=regular(fd,524288); data=read_all(fd,524288)
  finally: os.close(fd)
 finally: os.close(pfd)
 try: text=data.decode('utf-8')
 except UnicodeDecodeError: raise ValueError('text files only')
 print(json.dumps({'path':sys.argv[2],'content':text,'bytes':st.st_size}))
elif op=='write':
 data=base64.b64decode(sys.argv[3],validate=True)
 if len(data)>524288: raise ValueError('file too large')
 try: data.decode('utf-8')
 except UnicodeDecodeError: raise ValueError('text files only')
 pfd,name=parent_leaf(sys.argv[2],True); tmp=f'.aira-write-{os.getpid()}-{os.urandom(8).hex()}'
 try:
  mode=0o644
  try: current=os.open(name,os.O_RDONLY|O_NOFOLLOW,dir_fd=pfd)
  except FileNotFoundError: current=None
  if current is not None:
   try:
    st=os.fstat(current)
    if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1: raise ValueError('file unavailable')
    mode=stat.S_IMODE(st.st_mode)
   finally: os.close(current)
  fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|O_NOFOLLOW,0o600,dir_fd=pfd)
  try:
   os.fchmod(fd,mode)
   view=memoryview(data)
   while view:
    written=os.write(fd,view); view=view[written:]
   os.fsync(fd)
  finally: os.close(fd)
  os.replace(tmp,name,src_dir_fd=pfd,dst_dir_fd=pfd)
  os.fsync(pfd)
 finally:
  try: os.unlink(tmp,dir_fd=pfd)
  except FileNotFoundError: pass
  os.close(pfd)
 print(json.dumps({'path':sys.argv[2],'bytes':len(data),'written':True}))
elif op=='move':
 spfd,sname=parent_leaf(sys.argv[2]); dpfd,dname=parent_leaf(sys.argv[3],True)
 try:
  sfd=os.open(sname,os.O_RDONLY|O_NOFOLLOW,dir_fd=spfd)
  try: regular(sfd,524288)
  finally: os.close(sfd)
  try:
   dfd=os.open(dname,os.O_RDONLY|O_NOFOLLOW,dir_fd=dpfd)
  except FileNotFoundError: dfd=None
  if dfd is not None:
   try: regular(dfd,524288)
   finally: os.close(dfd)
  os.rename(sname,dname,src_dir_fd=spfd,dst_dir_fd=dpfd)
 finally:
  os.close(spfd); os.close(dpfd)
 print(json.dumps({'from':sys.argv[2],'to':sys.argv[3],'moved':True}))
elif op=='delete':
 pfd,name=parent_leaf(sys.argv[2])
 try:
  st=os.stat(name,dir_fd=pfd,follow_symlinks=False)
  if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1: raise ValueError('file unavailable')
  os.unlink(name,dir_fd=pfd)
 finally: os.close(pfd)
 print(json.dumps({'path':sys.argv[2],'deleted':True}))
elif op=='search':
 base_parts=parts(sys.argv[2] or '.',True); needle=sys.argv[3].lower(); limit=min(100,max(1,int(sys.argv[4]))); out=[]
 base_fd=open_dir(base_parts); stack=[(base_fd,base_parts)]
 while stack and len(out)<limit:
  fd,rel_parts=stack.pop()
  try:
   with os.scandir(fd) as entries:
    for entry in entries:
     if entry.name in SKIP: continue
     try:
      if entry.is_dir(follow_symlinks=False):
       child=os.open(entry.name,os.O_RDONLY|O_DIRECTORY|O_NOFOLLOW,dir_fd=fd)
       stack.append((child,[*rel_parts,entry.name]))
       continue
      if not entry.is_file(follow_symlinks=False): continue
      ffd=os.open(entry.name,os.O_RDONLY|O_NOFOLLOW,dir_fd=fd)
      try:
       regular(ffd,262144); data=read_all(ffd,262144)
      finally: os.close(ffd)
      text=data.decode('utf-8')
     except (OSError,UnicodeDecodeError,ValueError):
      continue
     path='/'.join([*rel_parts,entry.name])
     for i,line in enumerate(text.splitlines(),1):
      if needle in line.lower():
       out.append({'path':path,'line':i,'text':line[:500]})
       if len(out)>=limit: break
     if len(out)>=limit: break
  finally: os.close(fd)
 for fd,_ in stack:
  try: os.close(fd)
  except OSError: pass
 print(json.dumps({'matches':out,'truncated':len(out)>=limit}))
else: raise ValueError('unsupported operation')
`;

function invalid(message: string): never {
	throw new ToolGatewayError({ code: "TOOL_INPUT_INVALID", message, status: 400 });
}

async function ownedWorkspace(context: ToolContext, workspaceId: string): Promise<void> {
	const workspace = await getScopedWorktree(context, workspaceId);
	if (!workspace) {
		throw new ToolGatewayError({ code: "WORKTREE_NOT_FOUND", message: "Workspace is outside this mission and task scope.", status: 404 });
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
			await ownedWorkspace(context, parsed.data.workspaceId);
			return { result: await fileOperation(parsed.data.workspaceId, [action, parsed.data.path]) };
		}
		if (action === "write") {
			const parsed = FileWriteSchema.safeParse(input);
			if (!parsed.success) invalid("File write input is invalid.");
			await ownedWorkspace(context, parsed.data.workspaceId);
			return { result: await fileOperation(parsed.data.workspaceId, ["write", parsed.data.path, Buffer.from(parsed.data.content, "utf8").toString("base64")]) };
		}
		if (action === "move") {
			const parsed = FileMoveSchema.safeParse(input);
			if (!parsed.success) invalid("File move input is invalid.");
			await ownedWorkspace(context, parsed.data.workspaceId);
			return { result: await fileOperation(parsed.data.workspaceId, ["move", parsed.data.from, parsed.data.to]) };
		}
		if (action === "search") {
			const parsed = FileSearchSchema.safeParse(input);
			if (!parsed.success) invalid("File search input is invalid.");
			await ownedWorkspace(context, parsed.data.workspaceId);
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
			const sources = search.candidates
				.filter((source) => Boolean(publicWebUrl(source.url)))
				.slice(0, parsed.data.numResults)
				.map((source) => ({
					url: source.url,
					title: source.title,
					publishedDate: source.publishedDate,
					excerpt: source.excerpt.slice(0, 3_500),
					trust: UNTRUSTED_WEB_CONTENT,
					provenance: { provider: "exa", requestId: search.requestId ?? null },
				}));
			return { result: {
				requestId: search.requestId,
				searchType: search.searchType,
				trust: UNTRUSTED_WEB_CONTENT,
				provenance: { provider: "exa", requestId: search.requestId ?? null },
				sources,
			} };
		}
		if (action === "open") {
			const parsed = WebOpenSchema.safeParse(input);
			if (!parsed.success) invalid("Web open input is invalid.");
			const url = publicWebUrl(parsed.data.url);
			if (!url) invalid("Only credential-free public HTTP(S) URLs can be retrieved.");
			const search = await service.search(parsed.data.url, {
				numResults: 3,
				includeDomains: [url.hostname],
				contents: { textMaxCharacters: 6_000, highlightMaxCharacters: 3_000, highlightQuery: parsed.data.url },
			});
			const exact = search.candidates.find((source) => source.url === parsed.data.url && Boolean(publicWebUrl(source.url)))
				?? search.candidates.find((source) => webSourceMatchesRequestedTarget(url, source.url));
			if (!exact) throw new ToolGatewayError({ code: "WEB_RESOURCE_NOT_FOUND", message: "The web retrieval provider returned no public result in the requested host scope.", status: 404 });
			return { result: {
				requestedUrl: parsed.data.url,
				url: exact.url,
				title: exact.title,
				publishedDate: exact.publishedDate,
				excerpt: exact.excerpt.slice(0, 6_000),
				provider: "exa",
				trust: UNTRUSTED_WEB_CONTENT,
				provenance: { provider: "exa", requestId: search.requestId ?? null, requestedHost: url.hostname },
			} };
		}
		throw new ToolGatewayError({ code: "TOOL_ACTION_UNSUPPORTED", message: `Web action ${action} is not supported.`, status: 409 });
	},
};