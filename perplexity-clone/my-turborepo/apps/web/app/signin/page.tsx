import type { Metadata } from "next";
import { Suspense } from "react";

import { AiraLogo } from "../../components/AiraLogo";
import { SignInPanel } from "../../components/SignInPanel";
import {
	githubClientId,
	githubClientSecret,
	googleClientId,
	googleClientSecret,
} from "../../lib/oauth-env";

function oauthFlags() {
	return {
		google: !!googleClientId() && !!googleClientSecret(),
		github: !!githubClientId() && !!githubClientSecret(),
	};
}

export const metadata: Metadata = {
	title: "Sign in — Aira AI",
	description: "Enter Aira AI — one workspace for every intelligence.",
	robots: { index: false, follow: false },
};

export default function SignInPage() {
	const { google: showGoogle, github: showGitHub } = oauthFlags();

	return (
		<main className="aira-auth-stage">
			<section className="aira-auth-frame" aria-label="Aira AI authentication">
				<div className="aira-auth-visual">
					<div className="aira-auth-visual-noise" aria-hidden />
					<div className="aira-auth-orb" aria-hidden>
						<span className="aira-auth-orb-core" />
						<span className="aira-auth-orb-ring aira-auth-orb-ring-one" />
						<span className="aira-auth-orb-ring aira-auth-orb-ring-two" />
						<span className="aira-auth-orb-glow aira-auth-orb-glow-one" />
						<span className="aira-auth-orb-glow aira-auth-orb-glow-two" />
					</div>

					<div className="aira-auth-brand">
						<AiraLogo />
					</div>

					<div className="aira-auth-visual-copy">
						<p className="aira-auth-eyebrow">Aira intelligence workspace</p>
						<h2>
							One workspace.
							<br />
							Every intelligence.
						</h2>
						<p>
							Research, create, automate, compare models, and run agents from one continuous workspace.
						</p>
						<div className="aira-auth-capabilities" aria-label="Aira capabilities">
							<span>Chat</span>
							<span>Agents</span>
							<span>Research</span>
							<span>Files</span>
							<span>Models</span>
							<span>Workflows</span>
						</div>
					</div>
				</div>

				<div className="aira-auth-form-side">
					<div className="aira-auth-mobile-brand">
						<AiraLogo />
						<span className="aira-auth-mobile-orb" aria-hidden />
					</div>
					<Suspense
						fallback={
							<div className="aira-auth-panel-content flex min-h-[360px] items-center justify-center">
								<span className="aira-orbit-loader" aria-hidden />
							</div>
						}
					>
						<SignInPanel showGoogle={showGoogle} showGitHub={showGitHub} />
					</Suspense>
				</div>
			</section>
		</main>
	);
}
