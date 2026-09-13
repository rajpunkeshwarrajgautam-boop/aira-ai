import type { Metadata } from "next";
import Script from "next/script";
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
		<main className="aira-auth-stage aira-auth-stage-visme">
			<Script
				src="https://static-bundles.visme.co/forms/vismeforms-embed.js"
				strategy="afterInteractive"
			/>

			<section className="aira-auth-frame aira-auth-frame-visme" aria-label="Aira AI authentication">
				<div className="aira-auth-visual aira-auth-visme-column">
					<div className="aira-auth-visme-shell" aria-hidden="true">
						<div
							className="visme_d aira-auth-visme-embed"
							data-title="Webinar Registration Form"
							data-url="x9m86gyq-webinar-registration-form?fullPage=true"
							data-domain="forms"
							data-full-page="true"
							data-min-height="100vh"
							data-form-id="161717"
						/>
					</div>
					<div className="aira-auth-visme-shade" aria-hidden />

					<div className="aira-auth-brand aira-auth-visme-brand">
						<AiraLogo />
					</div>

					<div className="aira-auth-visual-copy aira-auth-visme-copy">
						<p className="aira-auth-eyebrow">Aira intelligence workspace</p>
						<h2>
							One workspace.
							<br />
							Every intelligence.
						</h2>
						<p>
							Research, create, automate, compare models, and run agents from one continuous workspace.
						</p>
					</div>
				</div>

				<div className="aira-auth-form-side aira-auth-form-side-visme">
					<div className="aira-auth-mobile-brand">
						<AiraLogo />
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
