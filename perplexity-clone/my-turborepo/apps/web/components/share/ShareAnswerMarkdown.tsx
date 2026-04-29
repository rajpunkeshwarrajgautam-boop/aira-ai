"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function ShareAnswerMarkdown({ markdown }: { readonly markdown: string }) {
	return (
		<div className="answer-markdown whitespace-pre-wrap text-[15px] leading-7 text-content-secondary">
			<ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
		</div>
	);
}

