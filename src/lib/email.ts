/**
 * Transactional email, via Resend.
 *
 * This exists to close a specific hole. Setup and password-reset links used to
 * be returned in the API response to the organizer who clicked the button, so
 * any organizer could redeem a founder's link, set a password of their
 * choosing, and sign in as that founder — reading conversations the whole
 * privacy model says they cannot see. Two clicks, no audit trail.
 *
 * The link now goes to the founder's own address and to nobody else. The
 * operator triggers an email they cannot read.
 *
 * No SDK: one POST to a documented endpoint is not worth a dependency.
 */

/**
 * Overridable so the integration tests can point at a local stand-in and
 * assert on what was actually sent — including that the setup link went to the
 * founder's address and not into an API response. Unset in production.
 */
const ENDPOINT = process.env.RESEND_BASE_URL?.trim() || "https://api.resend.com/emails";

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email delivery is not configured. Set RESEND_API_KEY and RESEND_FROM.");
    this.name = "EmailNotConfiguredError";
  }
}

export class EmailSendError extends Error {
  constructor(detail: string) {
    super(`Could not send the email: ${detail}`);
    this.name = "EmailSendError";
  }
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM?.trim());
}

type Message = { to: string; subject: string; text: string };

/**
 * Where a founder's reply goes.
 *
 * The From address is a no-reply on a dedicated sending subdomain, which is
 * right for automated mail — but the reset email tells a founder to raise the
 * alarm if they did not request the reset, and that instruction is worthless
 * if replying bounces. Setting reply_to keeps the From line official and still
 * lets a worried founder just hit reply.
 */
function replyTo(): string | undefined {
  return process.env.RESEND_REPLY_TO?.trim() || undefined;
}

/** Named in the body too, so it survives forwarding and plain-text clients. */
function contactLine(): string {
  const address = replyTo();
  return address
    ? `reply to this email (it reaches ${address})`
    : "tell the Sprint team straight away";
}

async function send(message: Message): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim();
  if (!apiKey || !from) throw new EmailNotConfiguredError();

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      ...(replyTo() ? { reply_to: [replyTo()] } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    // Read the provider's message for the server log, but never return it to
    // the browser — it can echo request detail back.
    const detail = await res.text().catch(() => "");
    console.error(`[email] Resend responded ${res.status}: ${detail.slice(0, 500)}`);
    throw new EmailSendError(`provider returned ${res.status}`);
  }
}

function signOff(): string {
  return `
— The Aalto Founder Sprint team

This link is single-use and expires in 14 days. Nobody on the operating team
can see it or your password.`;
}

/** First-time account setup. */
export function sendInviteEmail(to: string, name: string, link: string): Promise<void> {
  return send({
    to,
    subject: "Your Sprint Buddy account",
    text: `Hi ${name},

Your Sprint Buddy account is ready. Choose a password here:

${link}

Sprint Buddy is your own space. Your conversations are private — the operating
team sees themes and check-in signals, never what you wrote, unless you
explicitly share a conversation with them.
${signOff()}`,
  });
}

/** "Wednesday 16 September" — a date a person reads, not one a machine writes. */
function readableDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  return `${days[date.getUTCDay()]} ${d} ${months[date.getUTCMonth()]}`;
}

/**
 * A nudge about one deadline.
 *
 * Deliberately about a single milestone rather than a digest of everything
 * outstanding. A list of five things you are behind on is a reason to close the
 * email; one thing with a date is a reason to go and do it. The scheduler only
 * ever sends one of these per deadline per founder, so this cannot become a
 * daily list by accident.
 */
export function sendDeadlineReminder(
  to: string,
  name: string,
  deadline: { title: string; description: string | null; dueDate: string },
  kind: "due-soon" | "overdue",
  appUrl: string,
): Promise<void> {
  const when = kind === "overdue"
    ? `was due ${readableDate(deadline.dueDate)}`
    : `due tomorrow, ${readableDate(deadline.dueDate)}`;
  const subject = kind === "overdue"
    ? `Overdue: ${deadline.title}`
    : `Due tomorrow: ${deadline.title}`;

  const opener = kind === "overdue"
    ? `This one slipped past its date. That happens — it is worth five minutes to
either finish it or decide it is not happening.`
    : `A heads-up rather than a nag.`;

  return send({
    to,
    subject,
    text: `Hi ${name},

${opener}

  ${deadline.title}
  ${when}${deadline.description ? `\n  ${deadline.description}` : ""}

Tick it off here when it is done:

${appUrl}

You will not get another email about this one either way.

— The Aalto Founder Sprint team`,
  });
}

/**
 * Password reset.
 *
 * The warning line is deliberate. An organizer can still trigger this, and a
 * reset they did not ask for is the signal a founder needs that someone has
 * been in their account.
 */
export function sendResetEmail(to: string, name: string, link: string): Promise<void> {
  return send({
    to,
    subject: "Reset your Sprint Buddy password",
    text: `Hi ${name},

Someone asked for a password reset on your Sprint Buddy account. Set a new
password here:

${link}

If you did NOT request this, ${contactLine()} — it means somebody else
triggered a reset on your account.
${signOff()}`,
  });
}
