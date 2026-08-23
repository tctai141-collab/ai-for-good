# Privacy

Sprint Buddy is a coaching companion for the Aalto Founder Sprint, used by
about two dozen founders and the operating team. It holds things people write
when they are stuck, which is the most sensitive material a programme like this
produces. This document says what is kept, why, for how long, and who else
sees it.

**Controller:** Aalto Founder School — tai.tran@aalto.fi

---

## What is held

| Data | Why | Kept for |
|---|---|---|
| Email, name, role | Signing in; knowing who is in the cohort | Until the account is deleted |
| Password hash (Argon2id) | Signing in. The password itself is never stored | Until the account is deleted |
| Conversations with Sprint Buddy | The product | Until the founder deletes them, or the account goes |
| Decisions captured from a conversation | The founder's own record | Deleted with the conversation they came from |
| Check-in summaries, mood, theme | Lets the team see who is under strain | Until the account is deleted |
| Deadline completions | Progress tracking | Until the account is deleted |
| Session records | Staying signed in. Stored as SHA-256, never the cookie value | 24h idle / 14d absolute, then purged |
| Invite and reset tokens | Account setup. Stored as SHA-256 | 14 days, single use |
| Admin audit log | Accountability for organizer actions, including reading a shared conversation | Life of the deployment |

**Not held:** payment details, location, tracking or analytics cookies, IP
addresses in the database. Client IPs exist only in an in-memory rate-limit
counter that is lost on restart.

## Who can see what

Organizers can see a founder's **name, check-in signal, and deadline
progress** — and **only those conversations the founder has explicitly shared**.
Everything else is unreadable to them, enforced in the data layer and covered by
tests. Opening a shared conversation is written to the audit log and shown to
the founder as "Read by the team".

Founders can see only their own data.

## Email from the programme

Three kinds of email are sent to the address you registered with:

- **Account mail**: your setup link and password resets.
- **Deadline reminders**: at most two per milestone, the day before and the day
  after. Ignore both and you hear nothing further about that one.
- **Cohort announcements**: messages an organizer writes and sends to the
  cohort, addressed to you by name.

These are operational messages about a programme you enrolled in, so there is
no unsubscribe link. If you do not want them, that is a conversation with the
operating team rather than a setting.

**Every announcement is sent to you individually.** Your address is never
placed in a message to anybody else, so no participant learns another
participant's address from an email. Who sent each announcement, what it said,
and who received it is recorded in the audit log.

## Processors

| Who | What they get | Where |
|---|---|---|
| **Render** | Hosting, the database on a persistent disk | Frankfurt, EU |
| **Anthropic** | Message text, to generate replies | Requests may route via the US, Europe, Asia or Australia; data is **stored in the US**. Retention period confirmed as 30 days in the console (Settings, Privacy Controls). Inputs and outputs flagged under the Usage Policy are kept up to 2 years. Not used for model training. |
| **Resend** | Email address and the message, for invites and reminders | EU |
| **Cloudflare R2** | Encrypted database snapshots | EU |
| **Sentry** | Error type, stack, and route. **Never message content, request bodies or cookies** | See Sentry project region |

The Anthropic row is the one transfer that may leave the EU, and it is the most
significant one, because it carries what founders actually write. It must be
completed rather than left vague.

## Retention

- Conversations: until deleted by the founder
- Sessions: 24h idle, 14d absolute
- Invite and reset tokens: 14 days, single use
- Backups: **30 days**, then rotated out
- Rate-limit counters: 15 minutes, in memory only
- Announcements sent, and who received them: kept as a record, no fixed expiry

**Deleting is not instant everywhere.** A deleted conversation goes from the
live database immediately, and disappears from backups as those rotate — up to
30 days.

**Check-in summaries survive deleting a conversation.** They are written from
what was said and they carry the strain signal the team relies on. A deliberate
trade, recorded here because it means some words outlive the conversation they
came from.

## Your rights

- **A copy of your data** — `GET /api/account` returns everything held about
  you as JSON. No credentials, nobody else's data.
- **Deletion** — from your account settings, or ask an organizer. Removes you
  from all ten tables that reference you, in one transaction, with your sessions
  invalidated immediately.
- **Correction, objection, complaint** — email the address above. You may also
  complain to the Finnish Data Protection Ombudsman (tietosuoja.fi).

## How it is protected

Passwords hashed with Argon2id (m=65536, t=2, p=1). Session and invite tokens
stored only as SHA-256, so a copy of the database authenticates nobody. TLS
throughout, HSTS, strict cookie flags, CSRF checks on every state-changing
request. Ownership enforced in the data layer rather than in route handlers.
Backups can be AES-256-GCM encrypted before leaving the machine.

*Last reviewed: 22 August 2026.*
