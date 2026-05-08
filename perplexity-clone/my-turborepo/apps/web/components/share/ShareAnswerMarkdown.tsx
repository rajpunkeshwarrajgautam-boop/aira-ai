"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { markdownExternalLinkComponents } from "../markdownComponents";
import { linkifyCitations } from "../../src/services/citations";

export function ShareAnswerMarkdown({ markdown, maxValid = 20 }: { readonly markdown: string; readonly maxValid?: number }) {
	const linkedContent = linkifyCitations(markdown, maxValid);
	
	return (
		<div className="answer-markdown whitespace-pre-wrap text-[15px] leading-7 text-content-secondary">
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownExternalLinkComponents}>
				{linkedContent}
			</ReactMarkdown>
		</div>
	);
}

