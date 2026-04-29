"use client";

import { AlertCircle, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "../lib/cn";

export interface AnswerStreamProps {
	readonly markdown: string;
	readonly isStreaming: boolean;
	readonly phase: "idle" | "connecting" | "streaming" | "complete" | "error";
	readonly errorMessage?: string | null;
	readonly className?: string;
}

export function AnswerStream({
	markdown,
	isStreaming,
	phase,
	errorMessage,
	className,
}: AnswerStreamProps) {
	const showError = phase === "error" && errorMessage;
	const showIdleHint = phase === "idle" && !markdown && !showError;
	const showConnectingHint = phase === "connecting" && !markdown && !showError;
	const showStreamingHint = phase === "streaming" && !markdown && !showError;

	return (
		<section
			className={cn(
				"relative min-h-[120px] scroll-mt-8 rounded-2xl border border-border-subtle bg-surface-elevated/40 p-6 shadow-panel backdrop-blur-md",
				className,
			)}
			aria-busy={isStreaming}
			aria-live="polite"
		>
			<div className="mb-4 flex items-center gap-2 border-b border-border-subtle pb-4">
				<div className="flex size-8 items-center justify-center rounded-lg bg-accent/15">
					<Sparkles className="size-4 text-accent" aria-hidden />
				</div>
				<div>
					<h2 className="text-sm font-semibold tracking-tight text-content-primary">Answer</h2>
					<p className="text-xs text-content-tertiary">
						{phase === "streaming"
							? "Generating with live sources…"
							: phase === "complete"
								? "Grounded response"
								: phase === "connecting"
									? "Retrieving sources…"
									: phase === "error"
										? "Something went wrong"
										: "Results appear here"}
					</p>
				</div>
				{isStreaming ? (
					<span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-surface-inset px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-accent">
						<span className="relative flex size-2">
							<span className="absolute inline-flex size-full animate-ping rounded-full bg-accent/40 opacity-75" />
							<span className="relative inline-flex size-2 rounded-full bg-accent" />
						</span>
						Live
					</span>
				) : null}
			</div>

			{showError ? (
				<div
					className="flex gap-3 rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200"
					role="alert"
				>
					<AlertCircle className="size-5 shrink-0 text-red-400" aria-hidden />
					<p className="leading-relaxed">{errorMessage}</p>
				</div>
			) : null}

			{showIdleHint ? (
				<p className="text-sm leading-relaxed text-content-tertiary">
					Ask a question below. Answers stream in real time with numbered citations linked to web sources.
				</p>
			) : null}

			{showConnectingHint ? (
				<p className="text-sm leading-relaxed text-content-secondary">
					Connecting and retrieving sources…
				</p>
			) : null}

			{showStreamingHint ? (
				<p className="text-sm leading-relaxed text-content-tertiary">Synthesizing answer…</p>
			) : null}

			{markdown ? (
				<div className={cn("answer-markdown text-[15px] leading-7 text-content-secondary")}>
					<ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
					{isStreaming ? (
						<span
							className="ml-0.5 inline-block h-4 w-0.5 animate-pulse rounded-sm bg-accent align-middle"
							aria-hidden
						/>
					) : null}
				</div>
			) : null}
		</section>
	);
}
