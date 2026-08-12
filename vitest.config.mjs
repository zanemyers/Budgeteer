import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Separate from vite.config.mjs on purpose. That one sets `root: "src"` so the build's entry paths
// resolve, and inheriting it here would make every test path relative to src/ and put the Tailwind
// plugin in the way of a run that never renders CSS.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src/tsx") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/tsx/test/setup.ts"],
  },
});
