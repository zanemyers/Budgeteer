import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defaultAllowedOrigins, defineConfig } from "vite";

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
    cors: {
      // Vite only sends Access-Control-Allow-Origin to localhost origins by default. Django serves the
      // page from this machine's LAN IP when you browse from a phone, so that origin has to be allowed
      // too — otherwise the browser blocks every dev module and the app renders as a blank page with no
      // hint in the Django log. Dev-server-only; the built assets are served by Django, same-origin.
      origin: [defaultAllowedOrigins, /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(?::\d+)?$/],
    },
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
