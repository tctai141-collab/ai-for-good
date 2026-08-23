#!/usr/bin/env bun
/**
 * A stand-in for Resend, for trying email locally.
 *
 * Point RESEND_BASE_URL at this and every message the app sends is printed
 * here and written to .tmp/mailbox instead of being delivered. The alternative
 * for exercising a broadcast by hand is real credentials and real recipients,
 * which is not a thing to do twice.
 *
 * It speaks just enough of the Resend API to be indistinguishable from it as
 * far as src/lib/email.ts is concerned: accept a POST, answer with an id.
 *
 * Usage:
 *   bun scripts/dev-mailbox.ts [port]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const port = Number(process.argv[2] ?? 3025);
const dir = join(process.cwd(), ".tmp", "mailbox");
mkdirSync(dir, { recursive: true });

let count = 0;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    if (request.method !== "POST") {
      return new Response("dev mailbox: POST /emails", { status: 405 });
    }

    let message: { to?: string[]; from?: string; subject?: string; text?: string };
    try {
      message = await request.json();
    } catch {
      return Response.json({ error: "not json" }, { status: 400 });
    }

    count += 1;
    const to = message.to?.[0] ?? "(nobody)";
    const subject = message.subject ?? "(no subject)";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = join(dir, `${String(count).padStart(3, "0")}-${stamp}.txt`);

    writeFileSync(
      file,
      `To: ${to}\nFrom: ${message.from ?? ""}\nSubject: ${subject}\n\n${message.text ?? ""}\n`,
    );

    console.log(`\n${"=".repeat(72)}`);
    console.log(`#${count}  To: ${to}`);
    console.log(`    Subject: ${subject}`);
    console.log("-".repeat(72));
    console.log(message.text ?? "");
    console.log(`${"=".repeat(72)}\nSaved to ${file}\n`);

    return Response.json({ id: crypto.randomUUID() });
  },
});

console.log(`Dev mailbox listening on http://127.0.0.1:${server.port}/emails`);
console.log(`Messages are written to ${dir}`);
console.log("Nothing is delivered. Stop with Ctrl+C.\n");
