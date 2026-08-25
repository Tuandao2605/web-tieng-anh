import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier";

export default defineConfig(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // Console output is the current server/worker logger. Keep unsupported
      // console methods prohibited while allowing the methods used by the app.
      "no-console": ["error", { allow: ["log", "warn", "error"] }],
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
