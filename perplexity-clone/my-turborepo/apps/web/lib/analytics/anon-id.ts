import crypto from "node:crypto";

import { cookies } from "next/headers";

const COOKIE_NAME = "perplexity_analytics_anon_id";
const ANON_ID_BYTES = 24;
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2; // 2 years
const ANON_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/;

function newAnonId(): string {
	return crypto.randomBytes(ANON_ID_BYTES).toString("base64url");
}

async function getJar() {
	return cookies();
}

export async function getOrCreateAnonymousIdCookie(): Promise<string> {
	const jar = await getJar();
	const existing = jar.get(COOKIE_NAME)?.value;
	if (existing && ANON_ID_PATTERN.test(existing)) return existing;

	const id = newAnonId();
	jar.set(COOKIE_NAME, id, {
		httpOnly: true,
		sameSite: "lax",
		secure: process.env.NODE_ENV === "production",
		path: "/",
		maxAge: MAX_AGE_SECONDS,
	});
	return id;
}

export async function readAnonymousIdCookie(): Promise<string | undefined> {
	const jar = await getJar();
	const value = jar.get(COOKIE_NAME)?.value;
	return value && ANON_ID_PATTERN.test(value) ? value : undefined;
}
