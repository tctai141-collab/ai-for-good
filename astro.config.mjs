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
  // Astro's built-in CSRF check is replaced by the one in src/middleware.ts.
  //
  // Two problems made it worse than nothing here. It only inspects requests
  // whose content type is form-like, so every JSON API in this app — which is
  // all of them — went unchecked. And it compares the Origin header against the
  // URL the server thinks it is serving, which behind Render's TLS-terminating
  // proxy is http:// while the browser sends https://, so the requests it did
  // inspect were rejected in production and nowhere else. Sign-out was one of
  // them, and it failed silently for the life of the deployment.
  //
  // The replacement checks every unsafe method regardless of content type, and
  // compares hosts rather than full origins so the proxy cannot break it.
  security: { checkOrigin: false },
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
