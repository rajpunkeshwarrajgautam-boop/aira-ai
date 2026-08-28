const OMNIROUTE_PREVIEW_BRANCH = "feature/omniroute-gateway";

export function isOmniRoutePreviewTestAccessEnabled(): boolean {
return (
process.env.NODE_ENV === "production" &&
process.env.VERCEL_ENV === "preview" &&
process.env.VERCEL_GIT_COMMIT_REF === OMNIROUTE_PREVIEW_BRANCH &&
process.env.OMNIROUTE_PREVIEW_TEST_BYPASS === "true"
);
}