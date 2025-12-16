import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs}"],
    ignores: ["**/test/**"],
    rules: {
      "no-unused-vars": "error",
      "no-useless-catch": "error",
      "no-case-declarations": "error",
      "no-useless-escape": "off",
      "no-control-regex": "off",
      "no-regex-spaces": "off",
    },
    plugins: {
      js
    },
    extends: ["js/recommended"],
    languageOptions: {
      globals: {
        ...globals.browser,
        process: "readonly",
        require: "readonly",
      }
    }
  },
]);
