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
				"relative min-h-[160px] scroll-mt-8 overflow-hidden rounded-3xl border border-border-subtle/50 bg-surface-elevated/85 p-8 shadow-float backdrop-blur-xl transition-all duration-500",
				className,
			)}
			aria-busy={isStreaming}
			aria-live="polite"
		>
			<div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
			
			<div className="mb-6 flex items-center gap-4 border-b border-border-subtle/30 pb-6">
				<div className="flex size-10 items-center justify-center rounded-xl bg-accent/10 ring-1 ring-accent/20">
					<Sparkles className={cn("size-5 text-accent", isStreaming && "animate-spin-slow")} aria-hidden />
				</div>
				<div className="flex-1">
					<h2 className="text-[13px] font-bold tracking-tight text-content-primary">Assistant Response</h2>
					<p className="text-[11px] font-medium text-content-tertiary">
						{phase === "streaming"
							? "Generating intelligent synthesis…"
							: phase === "complete"
								? "Verified grounded response"
								: phase === "connecting"
									? "Analyzing retrieved intelligence…"
									: phase === "error"
										? "System encounter error"
										: "Synthesized results will appear here"}
					</p>
				</div>
				{isStreaming ? (
					<div className="ml-auto flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1.5 ring-1 ring-accent/20">
						<div className="flex items-center gap-1">
							<span className="size-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
							<span className="size-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
							<span className="size-1.5 animate-bounce rounded-full bg-accent" />
						</div>
						<span className="text-[10px] font-bold uppercase tracking-widest text-accent">Processing</span>
					</div>
				) : null}
			</div>

			{showError ? (
				<div
					className="flex gap-3 rounded-2xl border border-red-500/25 bg-red-500/5 p-5 text-sm text-red-200"
					role="alert"
				>
					<AlertCircle className="size-5 shrink-0 text-red-400" aria-hidden />
					<p className="font-medium leading-relaxed">{errorMessage}</p>
				</div>
			) : null}

			{showIdleHint ? (
				<div className="flex flex-col items-center justify-center py-8 text-center">
					<div className="mb-4 flex size-12 items-center justify-center rounded-full bg-surface-inset ring-1 ring-border-subtle/50">
						<Sparkles className="size-6 text-content-tertiary/40" />
					</div>
					<p className="max-w-[280px] text-[13px] leading-relaxed text-content-tertiary/80">
						Initiate a query to generate real-time synthesized answers with verifiable citations.
					</p>
				</div>
			) : null}

			{showConnectingHint || showStreamingHint ? (
				<div className="space-y-4 py-4">
					<div className="h-4 w-3/4 animate-pulse rounded-md bg-surface-inset/60" />
					<div className="h-4 w-1/2 animate-pulse rounded-md bg-surface-inset/40" />
					<div className="h-4 w-2/3 animate-pulse rounded-md bg-surface-inset/50" />
				</div>
			) : null}

			{markdown ? (
				<div className={cn("answer-markdown text-[15px] leading-8 text-content-secondary/90")}>
					<ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
					{isStreaming ? (
						<span
							className="ml-1 inline-block h-5 w-1 animate-pulse rounded-full bg-accent align-middle"
							aria-hidden
						/>
					) : null}
				</div>
			) : null}
		</section>
	);
}
