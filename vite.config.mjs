import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "src",
  base: "/public/static/",
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
      input: {
        main: "src/css/main.css",
        budget: "src/tsx/main.tsx",
      },
    },
  },
});
