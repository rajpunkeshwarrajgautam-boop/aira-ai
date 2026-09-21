"use client";

import { Check, ChevronRight, Loader2 } from "lucide-react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { safeAuthReturnPath } from "../lib/auth-origin";
import { Button } from "./ui/button";
import { logProductEvent } from "../lib/log-product-event";

export interface SignInPanelProps {
	readonly showGoogle: boolean;
	readonly showGitHub: boolean;
}

type AuthMode = "signin" | "signup";

export function SignInPanel({ showGoogle, showGitHub }: SignInPanelProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const requestedCallbackUrl = searchParams.get("callbackUrl") ?? "/";
	const authError = searchParams.get("error");
	const initialMode: AuthMode = searchParams.get("mode") === "signup" ? "signup" : "signin";
	const [mode, setMode] = useState<AuthMode>(initialMode);
	const [pending, setPending] = useState<string | null>(null);
	const [oauthError, setOAuthError] = useState(false);
	const [completedProvider, setCompletedProvider] = useState<string | null>(null);

	const providerVerb = mode === "signup" ? "Create account with" : "Continue with";
	const heading = mode === "signup" ? "Create your Aira account" : "Welcome back";
	const supportingCopy =
		mode === "signup"
			? "Start with one identity. Your workspace, agents, research, and memory stay connected from day one."
			: "Continue to your Aira workspace, exactly where you left off.";

	const providerCount = Number(showGoogle) + Number(showGitHub);
	const statusHeight = useMemo(() => (providerCount > 1 ? "min-h-[132px]" : "min-h-[72px]"), [providerCount]);

	const setAuthMode = (nextMode: AuthMode) => {
		if (pending) return;
		setMode(nextMode);
		setOAuthError(false);
		const params = new URLSearchParams(searchParams.toString());
		if (nextMode === "signup") params.set("mode", "signup");
		else params.delete("mode");
		const query = params.toString();
		router.replace(query ? `/signin?${query}` : "/signin", { scroll: false });
	};

	const handleOAuth = async (providerId: "google" | "github") => {
		setPending(providerId);
		setOAuthError(false);
		setCompletedProvider(null);
		try {
			const returnPath = safeAuthReturnPath(requestedCallbackUrl, window.location.origin);
			const result = await signIn(providerId, {
				redirect: false,
				redirectTo: returnPath,
			});
			if (!result?.url) throw new Error("OAuth provider did not return an authorization URL");
			setCompletedProvider(providerId);
			window.location.assign(result.url);
		} catch {
			setOAuthError(true);
			setCompletedProvider(null);
			setPending(null);
		}
	};

	return (
		<div className="aira-auth-panel-content">
			<div className="aira-auth-tabs" role="tablist" aria-label="Authentication mode">
				<button
					type="button"
					role="tab"
					aria-selected={mode === "signin"}
					className="aira-auth-tab"
					onClick={() => setAuthMode("signin")}
				>
					Sign in
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={mode === "signup"}
					className="aira-auth-tab"
					onClick={() => setAuthMode("signup")}
				>
					Create account
				</button>
				<span className={`aira-auth-tab-indicator ${mode === "signup" ? "is-signup" : ""}`} aria-hidden />
			</div>

			<div className="mt-8">
				<p className="aira-auth-kicker">{mode === "signup" ? "New workspace" : "Aira workspace"}</p>
				<h1 className="aira-auth-heading">{heading}</h1>
				<p className="aira-auth-supporting">{supportingCopy}</p>
			</div>

			<div className={`mt-8 ${statusHeight}`} aria-live="polite">
				{authError || oauthError ? (
					<div role="alert" className="aira-auth-alert">
						Sign-in could not be completed. Try again from this page.
					</div>
				) : null}

				{!showGoogle && !showGitHub ? (
					<div className="aira-auth-alert">
						No sign-in providers are configured. Add Google and/or GitHub OAuth credentials to enable authentication.
					</div>
				) : (
					<div className="flex flex-col gap-3">
						{showGoogle ? (
							<ProviderButton
								provider="google"
								label={`${providerVerb} Google`}
								pending={pending}
								completed={completedProvider}
								onClick={() => void handleOAuth("google")}
							/>
						) : null}
						{showGitHub ? (
							<ProviderButton
								provider="github"
								label={`${providerVerb} GitHub`}
								pending={pending}
								completed={completedProvider}
								onClick={() => void handleOAuth("github")}
							/>
						) : null}
					</div>
				)}
			</div>

			<p className="aira-auth-privacy">
				By continuing, you agree to Aira&apos;s Terms and Privacy Policy. Your provider shares only the profile data required for authentication and account linking.
			</p>
		</div>
	);
}

function ProviderButton({
	provider,
	label,
	pending,
	completed,
	onClick,
}: {
	readonly provider: "google" | "github";
	readonly label: string;
	readonly pending: string | null;
	readonly completed: string | null;
	readonly onClick: () => void;
}) {
	const isPending = pending === provider;
	const isCompleted = completed === provider;
	return (
		<Button
			variant="outline"
			disabled={pending !== null}
			onClick={onClick}
			aria-busy={isPending}
			className="aira-auth-provider group"
		>
			<span className="flex items-center gap-3">
				{provider === "google" ? <GoogleGlyph /> : <GitHubGlyph />}
				<span>{isPending ? "Connecting…" : label}</span>
			</span>
			{isPending ? (
				<Loader2 className="size-4 animate-spin" aria-hidden />
			) : isCompleted ? (
				<Check className="size-4" aria-hidden />
			) : (
				<ChevronRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
			)}
		</Button>
	);
}

function GoogleGlyph() {
	return (
		<span className="aira-auth-provider-icon bg-white">
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="size-5" aria-hidden>
				<path fill="#FFC107" d="M43.611 20.083 H42 V20 H24 v8 h11.303 c-1.649 4.657 -6.08 8 -11.303 8 c-6.627 0 -12 -5.373 -12 -12 s5.373 -12 12 -12 c3.059 0 5.842 1.154 7.961 3.039 l5.657 -5.657 C34.046 6.053 29.268 4 24 4 C12.955 4 4 12.955 4 24 c8.955 0 16.318 4.337 19.667 10.691 C24 44 32.955 44 44 44 c0 -1.341 -0.138 -2.65 -0.389 -3.917 z" />
				<path fill="#FF3D00" d="M6.306 14.691 l6.571 4.819 C14.655 15.108 18.961 12 24 12 c3.059 0 5.842 1.154 7.961 3.039 l5.657 -5.657 C34.046 6.053 29.268 4 24 4 C16.318 4 9.656 8.337 6.306 14.691 z" />
				<path fill="#4CAF50" d="M24 44 c5.166 0 9.86 -1.977 13.409 -5.192 l-6.19 -5.238 A11.91 11.91 0 0 1 24 36 c-5.202 0 -9.619 -3.317 -11.283 -7.946 l-6.522 5.025 C9.505 39.556 16.227 44 24 44 z" />
				<path fill="#1976D2" d="M43.611 20.083 H42 V20 H24 v8 h11.303 a12.04 12.04 0 0 1 -4.087 5.571 l0.003 -0.002 l6.19 5.238 C36.971 39.205 44 34 44 24 c0 -1.341 -0.138 -2.65 -0.389 -3.917 z" />
			</svg>
		</span>
	);
}

function GitHubGlyph() {
	return (
		<span className="aira-auth-provider-icon bg-[#24292f] text-white">
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-5" aria-hidden>
				<path fill="currentColor" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
			</svg>
		</span>
	);
}
