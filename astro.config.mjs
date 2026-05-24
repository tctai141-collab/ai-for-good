import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";

export default defineConfig({
  adapter: node({
    mode: "standalone",
  }),
  output: "server",
  integrations: [react()],
  server: {
    host: "0.0.0.0",
    port: 3000,
  },
  vite: {
    ssr: {
      // bun:* are native Bun modules — don't let Vite/Node bundle or resolve them
      external: ["bun:sqlite", "bun:ffi", "bun:test"],
    },
    optimizeDeps: {
      exclude: ["bun:sqlite"],
    },
  },
});
