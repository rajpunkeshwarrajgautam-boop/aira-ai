import assert from "node:assert/strict";
import test, { mock } from "node:test";

let sessionUser: { id: string } | null = null;

mock.module("@/auth", {
	exports: {
		auth: mock.fn(async () => (sessionUser ? { user: sessionUser } : null)),
	},
});

test("Knowledge asset API rejects unauthenticated requests with 401", async () => {
	sessionUser = null;
	const { GET, DELETE } = await import("../app/api/knowledge/assets/[id]/route");

	const getReq = new Request("http://localhost/api/knowledge/assets/test-id", { method: "GET" });
	const getRes = await GET(getReq, { params: Promise.resolve({ id: "test-id" }) });
	assert.equal(getRes.status, 401);

	const delReq = new Request("http://localhost/api/knowledge/assets/test-id", { method: "DELETE" });
	const delRes = await DELETE(delReq, { params: Promise.resolve({ id: "test-id" }) });
	assert.equal(delRes.status, 401);
});

test("Knowledge asset API validates ID format", async () => {
	sessionUser = { id: "user_test_mock" };
	const { DELETE } = await import("../app/api/knowledge/assets/[id]/route");

	const delReq = new Request("http://localhost/api/knowledge/assets/", { method: "DELETE" });
	const delRes = await DELETE(delReq, { params: Promise.resolve({ id: "" }) });
	assert.equal(delRes.status, 400);
});
