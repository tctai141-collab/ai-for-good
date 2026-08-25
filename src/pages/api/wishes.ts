import type { APIRoute } from "astro";
import {
  addWishReply, countWishesSince, createWish, getWish, listUsersByRole,
  listWishesFor, listWishesFrom, recordAdminAction,
  type WishAudience,
} from "../../db/index";
import { getSessionUser } from "../../lib/auth";
import { configuredAppUrl } from "../../lib/appUrl";
import { sendWishEmail, sendWishReplyEmail } from "../../lib/email";
import { reportError } from "../../lib/errors";
import { cap, readJsonBody } from "../../lib/limits";

/**
 * Wishes: a founder asking the organizers or the mentors for something.
 *
 * Who reads what:
 *   founder    — their own wishes and the replies to them, nobody else's
 *   mentor     — everything addressed to the mentors
 *   organizer  — both queues, because they run the programme and a wish for a
 *                mentor is still theirs to make happen
 *
 * A founder never reads another founder's wish. It is addressed to the people
 * running the programme, not posted to the cohort, and somebody asking for help
 * with a cofounder problem has not agreed to say it in front of nineteen peers.
 */

const MAX_BODY = 2_000;

/*
 * Every wish emails a real person, so there is a cap.
 *
 * Six an hour is far above anything a founder does on purpose and far below
 * what makes an inbox unusable. Without it, one stuck key sends Mårten forty
 * emails and the feature gets switched off by whoever owns his inbox.
 */
const WISHES_PER_HOUR = 6;

const AUDIENCES: WishAudience[] = ["organizers", "mentors"];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const session = getSessionUser(cookies);
    if (!session) return json({ error: "Not signed in." }, 401);

    if (session.role === "founder") {
      return json({ wishes: listWishesFrom(session.email), scope: "mine" });
    }
    const queues: WishAudience[] =
      session.role === "organizer" ? ["organizers", "mentors"] : ["mentors"];
    return json({ wishes: listWishesFor(queues), scope: "inbox" });
  } catch (error) {
    reportError(error, { where: "wishes.GET" });
    return json({ error: "Could not load these." }, 500);
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const session = getSessionUser(cookies);
    if (!session) return json({ error: "Not signed in." }, 401);

    const read = await readJsonBody<Record<string, unknown>>(request);
    if (!read.ok) return read.response;
    const body = read.value;

    if (body.action === "reply") return reply(session, body);

    /* Staff do not send wishes. Nothing would break if they did, but the
       feature is the cohort's way of reaching the people running things, and a
       reply is the right shape for the other direction. */
    if (session.role !== "founder") {
      return json({ error: "Wishes come from the cohort." }, 403);
    }

    const text = cap(body.body, MAX_BODY).trim();
    if (!text) return json({ error: "Say what you would like." }, 400);

    const audience = AUDIENCES.includes(body.audience as WishAudience)
      ? (body.audience as WishAudience)
      : null;
    if (!audience) return json({ error: "Choose who this is for." }, 400);

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
    if (countWishesSince(session.email, hourAgo) >= WISHES_PER_HOUR) {
      return json({ error: "That is a lot in one hour. Try again shortly." }, 429);
    }

    const id = crypto.randomUUID();
    createWish(id, session.email, audience, text);

    /*
     * Written first, emailed after, and a failed send does not fail the
     * request. The wish is safely recorded and visible in the app either way;
     * telling a founder their message did not go through, when it did, would
     * have them send it again.
     */
    notify(audience, session.name || session.email, text).catch((error) => {
      reportError(error, { where: "wishes.notify" });
    });

    return json({ ok: true, id });
  } catch (error) {
    reportError(error, { where: "wishes.POST" });
    return json({ error: "That did not send. Nothing was recorded." }, 500);
  }
};

async function notify(audience: WishAudience, fromName: string, text: string): Promise<void> {
  const role = audience === "organizers" ? "organizer" : "mentor";
  const recipients = listUsersByRole(role);
  const base = configuredAppUrl();
  const link = base ? `${base}/admin` : "";
  await Promise.all(
    recipients.map((person) => sendWishEmail(person.email, fromName, text, link)),
  );
}

async function reply(
  session: { email: string; name: string; role: string },
  body: Record<string, unknown>,
): Promise<Response> {
  if (session.role !== "organizer" && session.role !== "mentor") {
    return json({ error: "Only organizers and mentors reply." }, 403);
  }

  const wishId = typeof body.id === "string" ? body.id : "";
  const wish = wishId ? getWish(wishId) : null;
  if (!wish) return json({ error: "That question is gone." }, 404);

  /* A mentor answers what was addressed to the mentors. Organizers answer
     either, matching what they are allowed to read. */
  if (session.role === "mentor" && wish.audience !== "mentors") {
    return json({ error: "That one was not addressed to you." }, 403);
  }

  const text = cap(body.body, MAX_BODY).trim();
  if (!text) return json({ error: "An empty reply says nothing." }, 400);

  const author = session.name || session.email;
  addWishReply(crypto.randomUUID(), wishId, session.email, author, text);
  recordAdminAction(session.email, "wish:reply", wish.fromEmail, wishId);

  const base = configuredAppUrl();
  sendWishReplyEmail(wish.fromEmail, author, text, base ? `${base}/` : "").catch((error) => {
    reportError(error, { where: "wishes.replyNotify" });
  });

  return json({ ok: true });
}
