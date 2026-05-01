import typography from "@tailwindcss/typography";
import type { Config } from "tailwindcss";

const config: Config = {
	darkMode: ["selector", '[data-theme="dark"]'],
	content: [
		"./app/**/*.{js,ts,jsx,tsx,mdx}",
		"./components/**/*.{js,ts,jsx,tsx,mdx}",
	],
	theme: {
		extend: {
			colors: {
				surface: {
					DEFAULT: "hsl(var(--surface) / <alpha-value>)",
					elevated: "hsl(var(--surface-elevated) / <alpha-value>)",
					inset: "hsl(var(--surface-inset) / <alpha-value>)",
				},
				border: {
					subtle: "hsl(var(--border-subtle) / <alpha-value>)",
					DEFAULT: "hsl(var(--border) / <alpha-value>)",
				},
				accent: {
					DEFAULT: "hsl(var(--accent) / <alpha-value>)",
					muted: "hsl(var(--accent-muted) / <alpha-value>)",
				},
				content: {
					primary: "hsl(var(--content-primary) / <alpha-value>)",
					secondary: "hsl(var(--content-secondary) / <alpha-value>)",
					tertiary: "hsl(var(--content-tertiary) / <alpha-value>)",
				},
			},
			boxShadow: {
				panel:
					"0 0 0 1px hsl(var(--border-subtle) / 0.4), 0 4px 16px -2px hsl(0 0% 0% / 0.05)",
				float:
					"0 0 0 1px hsl(var(--border-subtle) / 0.5), 0 12px 32px -4px hsl(0 0% 0% / 0.08)",
			},
			fontFamily: {
				sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
				mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
			},
		},
	},
	plugins: [typography],
};

export default config;
