import { nextJsConfig } from "@repo/eslint-config/next-js";

/** @type {import("eslint").Linter.Config[]} */
export default [
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
