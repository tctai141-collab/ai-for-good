import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * The two button materials, and the checkbox that came with them.
 *
 * Three things here fail silently and are cheap to guard:
 *
 *   The dependencies. The supplied components wanted @paper-design/shaders for
 *   a WebGL metal surface and radix for the checkbox. Neither was taken, and a
 *   later "just install it" would land a renderer and a shader bundle for one
 *   button. The package manifest is the only place that shows up.
 *
 *   The filter ids. `backdrop-filter: url(#id)` resolves against ids that are
 *   global to the document. Two elements defining one id is not an error
 *   anyone reports: every reference resolves to whichever mounted first, and
 *   if that one unmounts the rest lose their refraction with no warning.
 *
 *   The red. Both materials were asked to stay off the accent. The accent
 *   still marks state, so this is checked per rule rather than per file.
 */

const sprint = readFileSync("src/components/SprintBuddy.tsx", "utf-8");
const admin = readFileSync("src/pages/admin.astro", "utf-8");
const index = readFileSync("src/pages/index.astro", "utf-8");
/* Both define a filter id of their own, so they belong in the sweep below. */
const liquid = readFileSync("src/components/LiquidGlassButton.tsx", "utf-8");
const quick = readFileSync("src/components/QuickActions.tsx", "utf-8");
const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

/** One CSS rule's declarations, by selector, comments stripped. */
function rule(source: string, selector: string): string {
  const at = source.indexOf(selector + " {");
  expect(at).toBeGreaterThan(-1);
  const body = source.slice(at + selector.length + 2, source.indexOf("}", at));
  return body.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("no new dependencies", () => {
  test("the metal button did not bring a shader runtime", () => {
    const deps = Object.keys(pkg.dependencies ?? {});
    for (const unwanted of ["@paper-design/shaders", "@paper-design/shaders-react", "three"]) {
      expect(deps).not.toContain(unwanted);
    }
  });

  test("the checkbox did not bring radix", () => {
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => d.startsWith("@radix-ui/"))).toEqual([]);
    expect(deps).not.toContain("class-variance-authority");
    expect(deps).not.toContain("lucide-react");
  });
});

describe("glass filter ids", () => {
  test("every id defined for a glass surface is defined exactly once", () => {
    // Across the whole app, not per file: the ids are global to the document.
    const all = [sprint, admin, index, liquid, quick].join("\n");
    const defined = [...all.matchAll(/<filter\s+id="([a-z-]+)"/g)].map((m) => m[1]!);
    const fromProp = [...all.matchAll(/<GlassFilter id="([a-z-]+)"/g)].map((m) => m[1]!);
    const ids = [...defined, ...fromProp];
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every filter a surface samples through is one that exists", () => {
    const all = [sprint, admin, index, liquid, quick].join("\n");
    const defined = new Set([
      ...[...all.matchAll(/<filter\s+id="([a-z-]+)"/g)].map((m) => m[1]!),
      ...[...all.matchAll(/<GlassFilter id="([a-z-]+)"/g)].map((m) => m[1]!),
    ]);
    const used = [...all.matchAll(/backdrop-filter:\s*url\("#([a-z-]+)"\)/g)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThan(0);
    for (const id of used) expect([...defined]).toContain(id);
  });

  test("the button filter is mounted once at the root, not per button", () => {
    // One per button would put twenty elements on the same id.
    expect(sprint.match(/<GlassFilter id="btn-glass" \/>/g)?.length).toBe(1);
  });
});

describe("the materials", () => {
  test("the metal is a gradient wider than the button, so it has room to sweep", () => {
    for (const [source, selector] of [[sprint, ".btn-metal"], [admin, "button:not([class])"]] as const) {
      const css = rule(source, selector);
      expect(css).toContain("linear-gradient(");
      expect(css).toContain("background-size: 220% 100%");
      expect(css).toContain("background-position: 0% 50%");
    }
  });

  test("the sweep only runs under the pointer", () => {
    // The supplied component animates its shader permanently at speed 0.6. A
    // face that never stops moving competes with everything around it.
    expect(sprint).not.toMatch(/animation:[^;]*btn-metal/);
    expect(rule(sprint, ".btn-metal:hover:not(:disabled)")).toContain("background-position: 100% 50%");
  });

  test("neither material carries the accent", () => {
    for (const [source, selector] of [
      [sprint, ".btn-metal"], [sprint, ".btn-glass"],
      [admin, "button:not([class])"], [admin, "button.ghost"],
    ] as const) {
      const css = rule(source, selector);
      expect(css).not.toContain("--brand-accent");
      expect(css).not.toContain("var(--accent)");
    }
  });

  test("focus still uses the accent, because that is state", () => {
    expect(rule(sprint, ".btn-metal:focus-visible, .btn-glass:focus-visible")).toContain("--brand-accent");
    expect(rule(admin, "button:focus-visible")).toContain("var(--accent)");
  });

  test("both honour reduced motion", () => {
    expect(sprint).toMatch(/prefers-reduced-motion[\s\S]{0,400}\.btn-metal, \.btn-glass \{ transition: none/);
    expect(admin).toMatch(/prefers-reduced-motion[\s\S]{0,400}button:not\(\[class\]\), button\.ghost \{ transition: none/);
  });

  test("the admin metal is scoped to bare buttons", () => {
    // Every styled control on that page carries a class and sets no
    // box-shadow, so an unscoped rule would hang the metal rim on the tabs,
    // the quick menu and the date picker alike.
    expect(admin).toContain("button:not([class]) {");
    expect(admin).not.toMatch(/\n      button \{\n\s+position: relative;/);
  });
});

describe("the checkbox", () => {
  test("the tick is the supplied path, not two rotated borders", () => {
    const css = rule(sprint, ".deadline-check::after");
    expect(css).toContain("mask-image: url(\"data:image/svg+xml,");
    // The distinctive tail of the supplied path.
    expect(css).toContain("M8.53547");
    expect(sprint).not.toMatch(/\.deadline-check[^{]*\{[^}]*transform:[^;]*rotate\(45deg\)/);
  });

  test("the mark takes currentColor, so one rule serves both states", () => {
    expect(rule(sprint, ".deadline-check::after")).toContain("background: currentColor");
    expect(rule(sprint, ".deadline-check::after")).toContain("color: transparent");
    expect(sprint).toContain(".deadline-check:checked::after { color:");
  });

  test("the admin checkboxes use the same mark", () => {
    // Two checkbox designs in one app is the thing this avoids.
    expect(rule(admin, ".check::after")).toContain("M8.53547");
    // Two in the markup, plus the one the review list builds per draft.
    expect(admin.match(/<input type="checkbox" class="check"/g)?.length).toBe(3);
    expect(admin).not.toMatch(/<input type="checkbox"(?! class="check")/);
  });

  test("the data URI is permitted by the page's own CSP", () => {
    // A mask is fetched under img-src. Without data: it silently renders
    // nothing and the box is simply never ticked.
    const middleware = readFileSync("src/middleware.ts", "utf-8");
    expect(middleware).toContain("img-src 'self' data:");
  });
});
