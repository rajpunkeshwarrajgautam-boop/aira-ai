export function isOmniRoutePreviewTestAccessEnabled(): boolean {
	return (
		process.env.VERCEL_ENV === "preview" &&
		process.env.OMNIROUTE_PREVIEW_TEST_BYPASS === "true"
	);
}
