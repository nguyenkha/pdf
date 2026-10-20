import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default tseslint.config(
  { ignores: ["dist", "node_modules", "public/engine"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        location: "readonly",
        history: "readonly",
        localStorage: "readonly",
        URL: "readonly",
        File: "readonly",
        Blob: "readonly",
        Worker: "readonly",
        self: "readonly",
        setTimeout: "readonly",
      },
    },
    rules: { "no-undef": "off", "@typescript-eslint/no-explicit-any": "error" },
  },
);
