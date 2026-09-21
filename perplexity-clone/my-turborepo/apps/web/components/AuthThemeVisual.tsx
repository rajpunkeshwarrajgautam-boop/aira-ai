import { AiraLogo } from "./AiraLogo";
import type { AuthThemeId } from "../lib/auth-themes";

export function AuthThemeVisual({ theme, compact = false }: { readonly theme: AuthThemeId; readonly compact?: boolean }) {
	return (
		<div className={`aira-auth-theme-visual aira-auth-theme-${theme}${compact ? " is-compact" : ""}`}>
			<div className="aira-auth-theme-scene" aria-hidden="true">
				<span className="aira-auth-theme-shape shape-a" />
				<span className="aira-auth-theme-shape shape-b" />
				<span className="aira-auth-theme-shape shape-c" />
				<span className="aira-auth-theme-orbit orbit-a" />
				<span className="aira-auth-theme-orbit orbit-b" />
				<span className="aira-auth-theme-node node-a" />
				<span className="aira-auth-theme-node node-b" />
				<span className="aira-auth-theme-node node-c" />
				<span className="aira-auth-theme-line line-a" />
				<span className="aira-auth-theme-line line-b" />
			</div>

			{compact ? null : (
				<>
					<div className="aira-auth-theme-brand"><AiraLogo /></div>
					<div className="aira-auth-theme-copy">
						<p className="aira-auth-eyebrow">Aira intelligence workspace</p>
						<h2>One workspace.<br />Every intelligence.</h2>
						<p>Research, create, automate, compare models, and run agents from one continuous workspace.</p>
					</div>
				</>
			)}
		</div>
	);
}
