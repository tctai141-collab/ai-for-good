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
    body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }),
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

const SIGN_OFF = `
— The Aalto Founder Sprint team

This link is single-use and expires in 14 days. Nobody on the operating team
can see it or your password.`;

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
${SIGN_OFF}`,
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

If you did NOT request this, tell the Sprint team straight away — it means
somebody else triggered a reset on your account.
${SIGN_OFF}`,
  });
}
