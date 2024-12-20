import prettier from "eslint-plugin-prettier";
import eslintConfigPrettier from "eslint-config-prettier";
import js from "@eslint/js";
import globals from "globals";

export default [
    {
        ignores: ["lib/", "out/", "dist/"],
    },
    js.configs.recommended,
    eslintConfigPrettier,
    {
        plugins: { prettier },
        languageOptions: {
            parserOptions: {
                ecmaVersion: 2020,
                sourceType: "module",
            },
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
    },
];
