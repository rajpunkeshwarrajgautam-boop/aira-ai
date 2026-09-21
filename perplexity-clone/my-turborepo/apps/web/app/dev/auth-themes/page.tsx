import Link from "next/link";

import { AuthThemeVisual } from "../../../components/AuthThemeVisual";
import { AiraLogo } from "../../../components/AiraLogo";
import { AUTH_THEMES, DEFAULT_AUTH_THEME } from "../../../lib/auth-themes";

export const metadata = {
	title: "Aira Auth Theme Gallery",
	robots: { index: false, follow: false },
};

export default function AuthThemeGalleryPage() {
	return (
		<main className="aira-theme-gallery-page">
			<div className="aira-theme-gallery-shell">
				<header className="aira-theme-gallery-header">
					<div>
						<AiraLogo />
						<p className="aira-auth-eyebrow">Authentication design lab</p>
						<h1>Choose Aira&apos;s login experience.</h1>
						<p>
							All six previews use the same production authentication engine. Only the visual layer changes, so you can choose purely on brand, mood, and usability.
						</p>
					</div>
					<Link className="aira-theme-current-badge" href={`/signin?theme=${DEFAULT_AUTH_THEME}`}>
						Open current default
					</Link>
				</header>

				<section className="aira-theme-gallery-grid" aria-label="Aira authentication themes">
					{AUTH_THEMES.map((theme) => (
						<article className="aira-theme-card" key={theme.id}>
							<div className="aira-theme-card-preview">
								<AuthThemeVisual theme={theme.id} compact />
							</div>
							<div className="aira-theme-card-body">
								<div className="aira-theme-card-title-row">
									<h2>{theme.name}</h2>
									<span className="mood">{theme.mood}</span>
								</div>
								<p>{theme.description}</p>
								<div className="aira-theme-card-actions">
									<Link className="primary" href={`/signin?theme=${theme.id}`}>Open live preview</Link>
									<Link className="secondary" href={`/signin?theme=${theme.id}&mode=signup`}>Preview sign up</Link>
								</div>
							</div>
						</article>
					))}
				</section>
			</div>
		</main>
	);
}
