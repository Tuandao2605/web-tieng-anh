import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier";

export default defineConfig(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      "no-console": "warn",
      "prefer-const": "error",
      "@typescript-eslint/no-explicit-any": "warn",
      "no-undef": "off",
    },
  },
  {
    // chi dinh file can kiem tra
    files: ["src/**/*.ts"],
    // bo qua cac thu muc khong can thiet
    ignores: ["node_modules/", "dist/"],
  },
  eslintConfigPrettier,
);
