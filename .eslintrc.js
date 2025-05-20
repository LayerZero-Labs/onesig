require('@rushstack/eslint-patch/modern-module-resolution');
require('@rushstack/eslint-patch/custom-config-package-names');

// @ts-check
/** @type {import('eslint').ESLint.ConfigData} */
module.exports = {
    root: true,
    env: {
        browser: true,
        node: true,
        es6: true,
        jest: true,
    },
    extends: ['eslint:recommended'],
    overrides: [
        {
            files: ['**/*.ts', '**/*.mts'],
            extends: ['@layerzerolabs/eslint-config-next/recommended'],
        },
        {
            files: ['tsup.config.ts', 'hardhat.config.ts'],
            extends: ['@layerzerolabs/eslint-config-next/disable-type-checked'],
            parserOptions: {
                project: false,
            },
        },
        {
            files: ['**/*.cjs'],
            extends: ['eslint:recommended'],
            parser: 'espree',
            parserOptions: {
                sourceType: 'commonjs',
                ecmaVersion: 'latest',
            },
        },
        {
            files: ['**/*.mjs'],
            extends: ['eslint:recommended'],
            parser: 'espree',
            parserOptions: {
                sourceType: 'module',
                ecmaVersion: 'latest',
            },
        },
        {
            files: ['**/*.json'],
            extends: ['@layerzerolabs/eslint-config-next/recommended'],
        },
    ],
};
