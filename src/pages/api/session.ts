import type { APIRoute } from "astro";

const DEMO_USERS = [
  { email: "founder1@sprint.test", password: "demo-password", role: "founder", name: "Aino" },
  { email: "founder2@sprint.test", password: "demo-password", role: "founder", name: "Elias" },
  { email: "founder3@sprint.test", password: "demo-password", role: "founder", name: "Mika" },
  { email: "founder4@sprint.test", password: "demo-password", role: "founder", name: "Sara" },
  { email: "founder5@sprint.test", password: "demo-password", role: "founder", name: "Leena" },
  { email: "founder6@sprint.test", password: "demo-password", role: "founder", name: "Oskari" },
  { email: "founder7@sprint.test", password: "demo-password", role: "founder", name: "Nora" },
  { email: "founder8@sprint.test", password: "demo-password", role: "founder", name: "Joonas" },
  { email: "organizer1@sprint.test", password: "organizer-demo-password", role: "organizer", name: "Organizer" },
  { email: "organizer2@sprint.test", password: "organizer-demo-password", role: "organizer", name: "Lead Coach" },
] as const;

function isHttps(request: Request): boolean {
  return new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const body = await request.json() as { email: string; password: string };
  if (!body.email) return Response.json({ error: "email required" }, { status: 400 });
  if (!body.password) return Response.json({ error: "password required" }, { status: 400 });

  const email = body.email.trim().toLowerCase();
  const demoUser = DEMO_USERS.find((user) => user.email === email && user.password === body.password);
  if (!demoUser) return Response.json({ error: "invalid credentials" }, { status: 401 });

  cookies.set("session_user", JSON.stringify({ email: demoUser.email, name: demoUser.name, role: demoUser.role }), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    secure: isHttps(request),
  });

  return Response.json({ ok: true });
};

export const GET: APIRoute = async ({ cookies }) => {
  const raw = cookies.get("session_user");
  if (!raw || !raw.value) return Response.json({ user: null });

  try {
    const user = JSON.parse(raw.value) as { email: string; name: string; role: string };
    return Response.json({ user });
  } catch {
    return Response.json({ user: null });
  }
};

export const DELETE: APIRoute = async ({ cookies }) => {
  cookies.delete("session_user", { path: "/" });
  return Response.json({ ok: true });
};
