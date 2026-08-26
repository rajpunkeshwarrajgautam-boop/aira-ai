import { Layers } from "lucide-react";
import { redirect } from "next/navigation";

import "./prompt-studio.css";
import "../aira-v2.css";
import { auth } from "@/auth";
import { AiraV2Frame } from "@/components/AiraV2Frame";
import { PromptStudio } from "@/components/prompts/PromptStudio";

export const dynamic = "force-dynamic";

export const metadata = {
	title: "Prompt Studio — AIRA",
	description:
		"Author, version, test and publish AIRA prompt templates with security analysis and provenance.",
};

export default async function PromptsPage() {
	const session = await auth();
	if (!session?.user?.id) redirect("/signin?callbackUrl=%2Fprompts");

	return (
		<div className="aira-prompt-workspace aira-v2-page">
			<AiraV2Frame>
				<main className="prompt-studio-main">
					<header className="prompt-studio-masthead">
						<div className="prompt-studio-masthead-copy">
							<p className="prompt-studio-eyebrow">
								<Layers className="size-3.5" aria-hidden /> Prompt intelligence
							</p>
							<h1 className="prompt-studio-title">Prompt Studio</h1>
							<p className="prompt-studio-lede">
								Author reusable templates, keep an immutable version history, test drafts
								against real providers, and publish the version your workspace runs. AIRA&rsquo;s
								core policy, grounding and citation rules always compile above a template.
							</p>
						</div>
					</header>
					<PromptStudio />
				</main>
			</AiraV2Frame>
		</div>
	);
}
