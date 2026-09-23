import { nextJsConfig } from "@repo/eslint-config/next-js";

/** @type {import("eslint").Linter.Config[]} */
export default [
	// Exclude untracked diagnostic scripts — these are development tools,
	// not application code, and must not enter the application lint scope.
	{
		ignores: [
			"*.cjs",
			"*.mjs",
		],
	},
	...nextJsConfig,
	{
		linterOptions: {
			reportUnusedDisableDirectives: "off",
		},
		rules: {
			"@typescript-eslint/no-unused-vars": "off",
			"turbo/no-undeclared-env-vars": "off",
			"no-extra-boolean-cast": "off",
		},
	},
];

