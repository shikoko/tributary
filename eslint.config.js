// Linting the frontend: TypeScript's recommended checks, and React's rules of hooks (hooks
// called in the same order every render, and effects listing what they use).
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "node_modules", "tools", "docs"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Unused names are already errors in TypeScript's own check (noUnusedLocals).
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
