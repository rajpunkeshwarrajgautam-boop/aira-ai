import type { Components } from "react-markdown";

/**
 * Open external http(s) links from model markdown in a new tab safely.
 * Also adds citation-link class to local source anchors.
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
		// Add citation-link class to source anchors for styling
		if (href && href.startsWith("#source-")) {
			return (
				<a
					href={href}
					className="citation-link"
					onClick={(e) => {
						e.preventDefault();
						const id = href.slice(1);
						const el = document.getElementById(id);
						if (el) {
							el.scrollIntoView({ behavior: "smooth", block: "start" });
							window.history.pushState(null, "", href);
						}
					}}
					{...props}
				>
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


