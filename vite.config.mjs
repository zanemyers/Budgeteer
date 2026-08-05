import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "src",
  base: "/public/static/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/tsx"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    open: false,
    watch: {
      usePolling: true,
    },
  },
  build: {
    outDir: "../public/static/dist/js",
    assetsDir: "",
    manifest: true,
    emptyOutDir: true,
    rollupOptions: {
      // Relative to `root` above, not to the project directory. Vite 6 tolerated the project-relative
      // form; Vite 8 resolves it against root and looks for src/src/..., fails, and then skips
      // dependency pre-bundling for the whole dev server. That leaves a bare import like `radix-ui`
      // unresolvable in the browser, so the first page to import a not-yet-bundled dependency breaks
      // with nothing in the Django log to suggest why. These two strings are also the manifest keys
      // the vite_asset tags look up, so they have to stay css/main.css and tsx/main.tsx.
      input: {
        main: "css/main.css",
        budget: "tsx/main.tsx",
      },
    },
  },
});
