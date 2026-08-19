function storageConfig(): { baseUrl: string; serviceKey: string; bucket: string } {
	const baseUrl = (
		process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || ""
	).replace(/\/$/, "");
	const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
	const bucket = process.env.AIRA_KNOWLEDGE_BUCKET?.trim() || "aira-knowledge";
	if (!baseUrl || !serviceKey) {
		throw new Error("Knowledge object storage is not configured.");
	}
	return { baseUrl, serviceKey, bucket };
}

function encodedObjectPath(path: string): string {
	return path
		.split("/")
		.filter(Boolean)
		.map((segment) => encodeURIComponent(segment))
		.join("/");
}

function authHeaders(serviceKey: string): Record<string, string> {
	return {
		apikey: serviceKey,
		Authorization: `Bearer ${serviceKey}`,
	};
}

function arrayBufferBody(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

export function knowledgeStorageConfigured(): boolean {
	return Boolean(
		(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
			process.env.SUPABASE_SERVICE_ROLE_KEY,
	);
}

export async function uploadKnowledgeObject(args: {
	readonly storageKey: string;
	readonly mimeType: string;
	readonly bytes: Uint8Array;
}): Promise<void> {
	const cfg = storageConfig();
	const response = await fetch(
		`${cfg.baseUrl}/storage/v1/object/${encodeURIComponent(cfg.bucket)}/${encodedObjectPath(args.storageKey)}`,
		{
			method: "POST",
			headers: {
				...authHeaders(cfg.serviceKey),
				"Content-Type": args.mimeType,
				"x-upsert": "false",
			},
			body: arrayBufferBody(args.bytes),
			cache: "no-store",
		},
	);
	if (!response.ok) {
		throw new Error(`Knowledge object upload failed with HTTP ${response.status}.`);
	}
}

export async function createKnowledgeSignedUrl(
	storageKey: string,
	expiresInSeconds = 3600,
): Promise<string> {
	const cfg = storageConfig();
	const response = await fetch(
		`${cfg.baseUrl}/storage/v1/object/sign/${encodeURIComponent(cfg.bucket)}/${encodedObjectPath(storageKey)}`,
		{
			method: "POST",
			headers: {
				...authHeaders(cfg.serviceKey),
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ expiresIn: Math.min(Math.max(expiresInSeconds, 60), 7200) }),
			cache: "no-store",
		},
	);
	if (!response.ok) throw new Error(`Could not sign knowledge object URL (HTTP ${response.status}).`);
	const payload = (await response.json()) as { signedURL?: unknown; signedUrl?: unknown };
	const signedPath =
		typeof payload.signedURL === "string"
			? payload.signedURL
			: typeof payload.signedUrl === "string"
				? payload.signedUrl
				: null;
	if (!signedPath) throw new Error("Object storage returned no signed URL.");
	return signedPath.startsWith("http") ? signedPath : `${cfg.baseUrl}/storage/v1${signedPath}`;
}

export async function deleteKnowledgeObject(storageKey: string): Promise<void> {
	const cfg = storageConfig();
	const response = await fetch(`${cfg.baseUrl}/storage/v1/object/${encodeURIComponent(cfg.bucket)}`, {
		method: "DELETE",
		headers: {
			...authHeaders(cfg.serviceKey),
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ prefixes: [storageKey] }),
		cache: "no-store",
	});
	if (!response.ok && response.status !== 404) {
		throw new Error(`Knowledge object cleanup failed with HTTP ${response.status}.`);
	}
}
