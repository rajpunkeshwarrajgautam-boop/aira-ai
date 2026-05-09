"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { getMarkdownComponents } from "../markdownComponents";
import { linkifyCitations } from "../../src/services/citations";
import type { CitationItem } from "../CitationCards";

export function ShareAnswerMarkdown({ markdown, citations = [], maxValid = 20 }: { readonly markdown: string; readonly citations?: readonly CitationItem[]; readonly maxValid?: number }) {
	const linkedContent = linkifyCitations(markdown, maxValid);
	
	return (
		<div className="answer-markdown whitespace-pre-wrap text-[15px] leading-7 text-content-secondary">
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={getMarkdownComponents(citations)}>
				{linkedContent}
			</ReactMarkdown>
		</div>
	);
}

