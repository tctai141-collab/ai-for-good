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
The Aalto Founder Sprint team

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

Sprint Buddy is your own space. Your conversations are private. The operating
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
 * email; one thing with a date is a reason to go and do it. The scheduler sends
 * each of these at most once per deadline per founder, and none of them at all
 * once the founder has ticked the deadline off.
 *
 * Four kinds, and the wording earns its place by being different each time. A
 * founder who gets the same sentence three days running learns to skim it,
 * which costs the last one its effect precisely when it matters most.
 *
 * The check-in line at the bottom is deliberate and is the only trigger the
 * product has. Tai ruled out emailing founders outside deadlines, which leaves
 * no channel to prompt a daily habit, so these emails carry the prompt instead
 * of a new one being invented. It costs nothing: the mail was going anyway.
 */
export function sendDeadlineReminder(
  to: string,
  name: string,
  deadline: { title: string; description: string | null; dueDate: string; dueTime?: string | null },
  kind: "due-soon" | "due-3d" | "due-2d" | "due-10h" | "overdue",
  appUrl: string,
): Promise<void> {
  const day = readableDate(deadline.dueDate);
  const at = deadline.dueTime ? ` at ${deadline.dueTime}` : "";

  const when = {
    "overdue": `was due ${day}${at}`,
    "due-10h": `due ${day}${at || ", end of day"}`,
    "due-2d": `due in two days, ${day}${at}`,
    "due-3d": `due in three days, ${day}${at}`,
    "due-soon": `due tomorrow, ${day}${at}`,
  }[kind];

  const subject = {
    "overdue": `Overdue: ${deadline.title}`,
    "due-10h": `Last call: ${deadline.title}`,
    "due-2d": `Two days: ${deadline.title}`,
    "due-3d": `Three days: ${deadline.title}`,
    "due-soon": `Due tomorrow: ${deadline.title}`,
  }[kind];

  /*
   * No opener, and nothing about the check-in.
   *
   * Each kind used to carry a sentence explaining why this particular email
   * had arrived — "far enough out to do something about", "a heads-up rather
   * than a nag" — and every one of them closed by suggesting a check-in. A
   * founder gets up to four of these per deadline. The subject line and the
   * date already say everything the reader came for, and the rest was the
   * email talking about itself.
   *
   * The check-in line was wrong twice over: it is an unrelated errand attached
   * to a reminder about something else, and the check-in is held closed until
   * the cohort has been shown it, so for now the sentence points at a screen
   * that will not open.
   *
   * What is left is what is due, when, and the one thing that stops the
   * emails.
   */
  return send({
    to,
    subject,
    text: `Hi ${name},

  ${deadline.title}
  ${when}${deadline.description ? `\n  ${deadline.description}` : ""}

Tick it off here and the reminders stop:

${appUrl}

The Aalto Founder Sprint team`,
  });
}

/**
 * A borrowed book that is due back, or already is.
 *
 * Separate from sendDeadlineReminder rather than a widening of it. That one is
 * written in deliverable vocabulary throughout ("Tick it off here when it is
 * done"), and its kind is an inline literal union, so sharing it would mean
 * rewriting its copy and widening that union to cover something it does not
 * mean. A book wants different words anyway: which book, where to put it, and
 * that bringing it back is the whole task.
 *
 * Two kinds, not the deadline path's five. Founders already get up to four
 * emails per milestone, and of the two this is the one to keep quiet.
 */
export function sendBookReminder(
  to: string,
  name: string,
  book: { title: string; dueDate: string },
  kind: "due-3d" | "overdue",
  appUrl: string,
): Promise<void> {
  const day = readableDate(book.dueDate);

  const subject = {
    "due-3d": `Due back ${day}: ${book.title}`,
    "overdue": `Overdue: ${book.title}`,
  }[kind];

  /*
   * Trimmed the same way as the deadline reminder, and for the same reason:
   * the opener was the email explaining itself. The subject already says which
   * book and when.
   *
   * Two sentences stay because they are things to do rather than things to
   * read: where the book goes, and that the date can be moved. Somebody who
   * cannot bring it back this week needs to know the second one exists.
   */
  return send({
    to,
    subject,
    text: `Hi ${name},

  ${book.title}
  due ${day}

Bring it back to the office shelf and mark it returned here; that stops the
reminders:

${appUrl}

If you need longer, tell an organizer and they will move the date.

The Aalto Founder Sprint team`,
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

If you did NOT request this, ${contactLine()}. It means somebody else
triggered a reset on your account.
${signOff()}`,
  });
}

/**
 * A cohort announcement, written by an organizer.
 *
 * The footer is not decoration. These go out without an unsubscribe link
 * because they are operational mail about a programme the recipient enrolled
 * in, the same basis as the deadline reminders — and the honest way to hold
 * that position is to tell people plainly why they are receiving it and who to
 * reply to, rather than leaving them to guess.
 *
 * The body is passed through as written. Nothing is appended to it beyond this
 * footer, so what the organizer reads in their test send is what the cohort
 * gets.
 */
export function sendBroadcastEmail(to: string, subject: string, text: string): Promise<void> {
  const contact = replyTo();
  return send({
    to,
    subject,
    text: `${text}

---
You are receiving this because you are registered on the Aalto Founder Sprint.
${contact ? `Questions: just reply, it reaches ${contact}.` : "Questions: reply to this email."}`,
  });
}

/**
 * Tells an organizer or mentor that a founder has asked them something.
 *
 * The wish itself is in the email because an email saying only "you have a
 * message, log in to read it" is a notification that wastes the reader's time
 * and gets ignored. Replying happens in the app, so the founder's own address
 * is not exposed to a reply-all and the answer is recorded where the founder
 * will look for it.
 */
export function sendWishEmail(
  to: string, fromName: string, body: string, link: string,
): Promise<void> {
  return send({
    to,
    subject: `${fromName} asked something`,
    text: `${fromName} sent this through Sprint Buddy:

${body}

Reply here: ${link}

---
You are receiving this because you are an organizer or mentor on the Aalto
Founder Sprint and this was addressed to you.`,
  });
}

/**
 * Tells the organizers something is broken.
 *
 * The screen and the browser are in the email rather than only in the admin
 * tab, because the first question anybody asks about a bug report is "where,
 * and on what" and the answer being one click away is not the same as it
 * being in front of you. They are also the two lines that decide whether it is
 * worth opening a laptop now or after lunch.
 *
 * Both came from the reporter's browser. They are printed as received and
 * nothing here reads them.
 */
export function sendBugReportEmail(
  to: string, fromName: string, body: string, page: string, userAgent: string, link: string,
): Promise<void> {
  const context = [
    page ? `Screen: ${page}` : "",
    userAgent ? `Browser: ${userAgent}` : "",
  ].filter(Boolean).join("\n");

  return send({
    to,
    subject: `${fromName} reported a bug`,
    text: `${fromName} reported this through Sprint Buddy:

${body}
${context ? `\n${context}\n` : ""}
Triage it here: ${link}

---
You are receiving this because you are an organizer on the Aalto Founder
Sprint.`,
  });
}

/** Tells a founder their wish was answered. */
export function sendWishReplyEmail(
  to: string, answeredBy: string, body: string, link: string,
): Promise<void> {
  return send({
    to,
    subject: `${answeredBy} answered you`,
    text: `${answeredBy} replied to what you asked:

${body}

See it in context: ${link}`,
  });
}
