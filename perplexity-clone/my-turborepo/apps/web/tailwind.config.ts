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
					"0 0 0 1px hsl(var(--border-subtle) / 0.45), 0 4px 20px -4px hsl(217 50% 50% / 0.06), 0 2px 8px -2px hsl(0 0% 0% / 0.04)",
				float:
					"0 0 0 1px hsl(0 0% 100% / 0.65), 0 0 0 1px hsl(var(--border-subtle) / 0.35) inset, 0 20px 50px -12px hsl(217 45% 40% / 0.12), 0 8px 24px -8px hsl(0 0% 0% / 0.06)",
				glass:
					"0 0 0 1px hsl(0 0% 100% / 0.55), 0 1px 2px hsl(0 0% 0% / 0.04), 0 16px 40px -20px hsl(217 40% 50% / 0.14)",
			},
			fontFamily: {
				sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
				mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
			},
			animation: {
				"spin-slow": "spin 3s linear infinite",
			},
			keyframes: {
				spin: {
					from: { transform: "rotate(0deg)" },
					to: { transform: "rotate(360deg)" },
				},
			},
		},
	},
	plugins: [typography],
};

export default config;
