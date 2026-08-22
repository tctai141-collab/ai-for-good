import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createFounder, createOrganizer, get, post, startServer, type Harness, type Session } from "./helpers/harness";
import { chunkTranscript, nameLeaks } from "../src/lib/extract";

/**
 * The transcript ingest.
 *
 * The extraction call itself is stubbed by the harness's stand-in advisor
 * endpoint; what is worth testing here is everything around it — who is allowed
 * to run it, that reading a transcript writes nothing on its own, that an
 * import lands after the existing pack rather than in the middle of it, and
 * that a whole source can be taken back out in one move.
 */

let h: Harness;
let organizer: Session;

beforeAll(async () => {
  h = await startServer();
  organizer = await createOrganizer(h, "organizer@example.test");
});

afterAll(() => h?.stop());

describe("chunking", () => {
  test("splits on blank lines and keeps every piece under the cap", () => {
    const paragraph = "word ".repeat(400).trim(); // ~2000 chars
    const chunks = chunkTranscript([paragraph, paragraph, paragraph].join("\n\n"), 2_500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(2_500);
  });

  test("hard-splits a single paragraph longer than the cap rather than dropping it", () => {
    const chunks = chunkTranscript("x".repeat(6_000), 2_500);
    expect(chunks.length).toBe(3);
    expect(chunks.join("").length).toBe(6_000);
  });

  test("discards fragments too short to be worth a call", () => {
    expect(chunkTranscript("too short", 2_500)).toEqual([]);
  });
});

describe("ingest API", () => {
  test("a founder cannot extract", async () => {
    const founder = await createFounder(h, organizer, "f1@example.test", "F One", "founder-password-11");
    const res = await post(
      h,
      "/api/knowledge",
      { action: "extract", source: "Someone", transcript: "x".repeat(500) },
      founder.cookie,
    );
    expect(res.status).toBe(403);
  });

  test("a signed-out visitor cannot extract", async () => {
    const res = await post(h, "/api/knowledge", {
      action: "extract",
      source: "Someone",
      transcript: "x".repeat(500),
    });
    expect(res.status).toBe(401);
  });

  test("an empty transcript is refused before any call is made", async () => {
    const res = await post(
      h,
      "/api/knowledge",
      { action: "extract", source: "Someone", transcript: "   " },
      organizer.cookie,
    );
    expect(res.status).toBe(400);
  });

  test("importing nothing is refused", async () => {
    const res = await post(
      h,
      "/api/knowledge",
      { action: "importBatch", source: "Someone", entries: [] },
      organizer.cookie,
    );
    expect(res.status).toBe(400);
  });

  test("an import lands after whatever is already there, and records its source", async () => {
    // MAX() over an empty table is NULL, and a fresh install now starts empty
    // — nothing seeds the knowledge base any more.
    const before = h
      .db()
      .query("SELECT MAX(position) AS p FROM knowledge_entries WHERE persona = 'sprint-buddy'")
      .get() as { p: number | null };
    const highest = before.p ?? 0;

    const res = await post(
      h,
      "/api/knowledge",
      {
        action: "importBatch",
        source: "Test Mentor",
        entries: [
          { topic: "PRICING", body: "Charge before the product is finished; the price is the question." },
          { topic: "HIRING", body: "Hire for the appetite to learn, not the length of the CV." },
        ],
      },
      organizer.cookie,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).saved).toBe(2);

    const rows = h
      .db()
      .query("SELECT topic, position, source, status FROM knowledge_entries WHERE source = 'Test Mentor' ORDER BY position")
      .all() as { topic: string; position: number; source: string; status: string }[];
    expect(rows.length).toBe(2);
    expect(rows[0]!.position).toBeGreaterThan(highest);
    expect(rows[0]!.status).toBe("active");
    // The source is recorded precisely because it never reaches the prompt:
    // it is what makes a whole session archivable and auditable later.
    expect(rows[1]!.source).toBe("Test Mentor");
  });

  test("an entry with no body is skipped rather than stored empty", async () => {
    const res = await post(
      h,
      "/api/knowledge",
      {
        action: "importBatch",
        source: "Sparse Mentor",
        entries: [{ topic: "NOTHING", body: "   " }, { topic: "SOMETHING", body: "A real position worth keeping." }],
      },
      organizer.cookie,
    );
    expect((await res.json()).saved).toBe(1);
  });

  test("archiving a source takes out all of its entries and leaves the rest", async () => {
    const activeElsewhere = () =>
      (
        h
          .db()
          .query("SELECT COUNT(*) AS n FROM knowledge_entries WHERE persona = 'marten' AND status = 'active' AND source != 'Test Mentor'")
          .get() as { n: number }
      ).n;

    const others = activeElsewhere();
    const res = await post(
      h,
      "/api/knowledge",
      { action: "archiveSource", source: "Test Mentor" },
      organizer.cookie,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).archived).toBe(2);

    const left = h
      .db()
      .query("SELECT COUNT(*) AS n FROM knowledge_entries WHERE source = 'Test Mentor' AND status = 'active'")
      .get() as { n: number };
    expect(left.n).toBe(0);
    expect(activeElsewhere()).toBe(others);
  });

  test("archiving an unknown source changes nothing and says so", async () => {
    const res = await post(
      h,
      "/api/knowledge",
      { action: "archiveSource", source: "Never Existed" },
      organizer.cookie,
    );
    expect((await res.json()).archived).toBe(0);
  });

  test("a founder cannot archive a source", async () => {
    const founder = await createFounder(h, organizer, "f2@example.test", "F Two", "founder-password-22");
    const res = await post(
      h,
      "/api/knowledge",
      { action: "archiveSource", source: "Test Mentor" },
      founder.cookie,
    );
    expect(res.status).toBe(403);
  });
});

describe("the admin page itself", () => {
  test("renders the panel and its inline script parses", async () => {
    // The admin script is one inline block: a syntax error anywhere in it takes
    // out people, deadlines, programme and knowledge at once, silently, and no
    // typecheck looks inside it. This is the only thing that would catch that.
    const res = await get(h, "/admin", organizer.cookie);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Add knowledge from a transcript");

    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    const inline = scripts.find((block) => block.includes("ingest-form"));
    expect(inline).toBeTruthy();
    expect(() => new Function(inline!)).not.toThrow();
  });

  test("every tab button has a panel and every panel has a button", async () => {
    // A typo in either half leaves a tab that opens nothing, or a section
    // nobody can reach — and a section nobody can reach looks exactly like a
    // feature that was never built.
    const html = await (await get(h, "/admin", organizer.cookie)).text();
    const buttons = [...html.matchAll(/data-tab="([a-z-]+)"/g)].map((m) => m[1]!);
    const panels = [...html.matchAll(/class="tabpanel" id="tab-([a-z-]+)"/g)].map((m) => m[1]!);

    expect(buttons.length).toBeGreaterThan(1);
    expect(buttons.slice().sort()).toEqual(panels.slice().sort());
  });

  test("all five areas are present", async () => {
    const html = await (await get(h, "/admin", organizer.cookie)).text();
    for (const slug of ["people", "deadlines", "programme", "knowledge", "transcript"]) {
      expect(html).toContain(`id="tab-${slug}"`);
    }
  });
});

describe("the name-leak guard", () => {
  /*
   * The prompt forbids naming the speaker three times over and mostly obeys.
   * "Mostly" is the wrong standard for something twenty founders will read, so
   * every candidate is checked before it is offered for review. This flags, it
   * does not edit — the operating team decides.
   */
  test("catches the speaker's name in a body", () => {
    expect(nameLeaks("Bastian bets on people before markets.", "Bastian — Index Venture")).toEqual(["Bastian"]);
  });

  test("catches the company as well as the person", () => {
    expect(nameLeaks("At Singa they price by usage.", "Atte — Singa").sort()).toEqual(["Singa"]);
  });

  test("passes a clean entry", () => {
    expect(nameLeaks("Back the people before the market.", "Bastian — Index Venture")).toEqual([]);
  });

  test("matches whole words only, so a short name does not light up every entry", () => {
    // A mentor called "Ed" must not flag "edge", "edit" or "hedge".
    expect(nameLeaks("Find your edge and edit the pitch.", "Ed")).toEqual([]);
  });

  test("ignores generic corporate words in a firm name", () => {
    // "Index Venture" must not make every entry mentioning venture capital
    // light up. An alarm that fires constantly is one nobody reads.
    expect(nameLeaks("Venture funds need variance, not consistency.", "Bastian — Index Venture")).toEqual([]);
    expect(nameLeaks("Most capital is patient until it isn't.", "Someone — Growth Capital Partners")).toEqual([]);
  });

  test("still catches the distinctive part of a firm name", () => {
    expect(nameLeaks("Index ran the numbers differently.", "Bastian — Index Venture")).toEqual(["Index"]);
  });

  test("is case-insensitive", () => {
    expect(nameLeaks("annu argues for bootstrapping.", "Annu Nieminen")).toEqual(["Annu"]);
  });

  test("an unnamed speaker flags nothing", () => {
    expect(nameLeaks("Any text at all.", "")).toEqual([]);
  });
});
