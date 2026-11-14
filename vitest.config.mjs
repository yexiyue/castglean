import { defineConfig } from "vitest/config";
import { lingui } from "@lingui/vite-plugin";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), lingui({ macroTransform: true })],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.mjs", "src/**/*.test.{ts,tsx}"],
    testTimeout: 30000,
  },
});
