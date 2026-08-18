import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";

export default defineConfig({
  adapter: node({
    mode: "standalone",
  }),
  // Note: the node adapter logs "Enabling sessions with filesystem storage" at
  // build time. There is no supported way to turn that off — `session` only
  // selects a driver — but nothing here ever touches Astro.session, so the
  // store is initialised and never written to. Authentication is the custom
  // server-side session table in src/lib/auth.ts. Left as-is deliberately
  // rather than swapped for a different driver that would also do nothing.
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
