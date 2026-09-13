export const AUTH_THEME_IDS = [
	"intelligence",
	"astronaut",
	"black-hole",
	"japanese-minimal",
	"minimal-ivory",
	"purple-leaves",
] as const;

export type AuthThemeId = (typeof AUTH_THEME_IDS)[number];

export interface AuthThemeDefinition {
	readonly id: AuthThemeId;
	readonly name: string;
	readonly description: string;
	readonly mood: string;
}

export const AUTH_THEMES: readonly AuthThemeDefinition[] = [
	{
		id: "intelligence",
		name: "Aira Intelligence",
		description: "Aira-native indigo intelligence field with connected agent nodes.",
		mood: "Signature · Intelligent · Premium",
	},
	{
		id: "astronaut",
		name: "Astronaut",
		description: "Deep-space composition with orbital motion and a restrained planetary glow.",
		mood: "Cinematic · Expansive · Memorable",
	},
	{
		id: "black-hole",
		name: "Black Hole",
		description: "Obsidian gravity well with a luminous accretion ring and minimal typography.",
		mood: "Dark · Focused · Powerful",
	},
	{
		id: "japanese-minimal",
		name: "Japanese Minimal",
		description: "Quiet editorial composition with warm paper, ink and a restrained sun motif.",
		mood: "Calm · Editorial · Refined",
	},
	{
		id: "minimal-ivory",
		name: "Minimal Ivory",
		description: "Clean product-first authentication with subtle geometry and almost no decoration.",
		mood: "Enterprise · Clear · Timeless",
	},
	{
		id: "purple-leaves",
		name: "Purple Leaves",
		description: "Soft botanical motion translated into Aira's violet visual language.",
		mood: "Expressive · Soft · Premium",
	},
] as const;

export const DEFAULT_AUTH_THEME: AuthThemeId = "astronaut";

export function isAuthThemeId(value: string | null | undefined): value is AuthThemeId {
	return !!value && (AUTH_THEME_IDS as readonly string[]).includes(value);
}

export function resolveAuthTheme(value: string | null | undefined): AuthThemeId {
	return isAuthThemeId(value) ? value : DEFAULT_AUTH_THEME;
}
