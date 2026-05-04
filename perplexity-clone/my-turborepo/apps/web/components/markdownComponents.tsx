import type { Components } from "react-markdown";

/**
 * Open external http(s) links from model markdown in a new tab safely.
 */
export const markdownExternalLinkComponents: Partial<Components> = {
	a: ({ href, children, ...props }) => {
		if (href && /^https?:\/\//i.test(href)) {
			return (
				<a href={href} target="_blank" rel="noopener noreferrer" {...props}>
					{children}
				</a>
			);
		}
		return (
			<a href={href} {...props}>
				{children}
			</a>
		);
	},
};
