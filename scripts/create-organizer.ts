#!/usr/bin/env bun
/**
 * Creates the first organizer account and prints a setup link.
 *
 * Needed once per deployment to break the chicken-and-egg problem: the admin
 * page requires an organizer to sign in, and only the admin page can create
 * accounts. After the first organizer sets their password, everyone else —
 * founders and the rest of the operating team — is added through the UI.
 *
 * Usage:
 *   bun scripts/create-organizer.ts <email> "<Full Name>" [base-url]
 *
 * Safe to re-run for an existing account: it issues a fresh link rather than
 * failing, which doubles as password recovery for the operating team.
 */

import { createInvite, createUser, getUserRow } from "../src/db/index";
import { inviteExpiry, normalizeEmail, randomToken } from "../src/lib/auth";

const [rawEmail, rawName, rawBaseUrl] = process.argv.slice(2);

if (!rawEmail || !rawName) {
  console.error("Usage: bun scripts/create-organizer.ts <email> \"<Full Name>\" [base-url]");
  console.error('Example: bun scripts/create-organizer.ts tai.tran@aalto.fi "Tai Tran"');
  process.exit(1);
}

const email = normalizeEmail(rawEmail);
const name = rawName.trim();
const baseUrl = (rawBaseUrl || "http://localhost:3000").replace(/\/+$/, "");

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error(`"${rawEmail}" does not look like an email address.`);
  process.exit(1);
}

const existing = getUserRow(email);
if (existing) {
  console.log(`${email} already has an account (${existing.role}). Issuing a fresh setup link.`);
} else {
  createUser(email, name, "organizer");
  console.log(`Created organizer account for ${name} <${email}>.`);
}

const token = randomToken();
createInvite(token, email, inviteExpiry());

console.log("");
console.log("Open this link to choose a password (valid for 14 days, single use):");
console.log("");
console.log(`  ${baseUrl}/setup?token=${token}`);
console.log("");
console.log("Then sign in and add the rest of the team and the cohort at /admin.");
