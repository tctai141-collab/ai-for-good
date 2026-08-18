/**
 * Named-parameter bindings for bun:sqlite.
 *
 * `bun:sqlite` supports binding by name — `.run({ $id: "x" })` — and the whole
 * data layer uses it, because positional binding in twenty-line SQL is how you
 * get the arguments out of order. The shipped types only describe the
 * positional form (`...params: SQLQueryBindings[]`), so every one of those
 * calls reports TS2353 despite working correctly at runtime.
 *
 * Verified before writing this, on bun 1.3.14 / @types/bun 1.3.14:
 *
 *   db.query("INSERT INTO t (id,v) VALUES ($id,$v)").run({ $id: "a", $v: "hi" });
 *   db.query("SELECT * FROM t WHERE id = $id").get({ $id: "a" });
 *   -> { id: "a", v: "hi" }
 *
 * These overloads describe that form. They are additive — the positional
 * signatures still apply — so nothing is silenced beyond the named-parameter
 * shape. Delete this file once @types/bun describes it directly.
 */
declare module "bun:sqlite" {
  type NamedBindings = Record<string, string | number | bigint | boolean | null | Uint8Array>;

  interface Statement<ReturnType = unknown> {
    // Optional, so statements taking no parameters still resolve.
    run(namedParameters?: NamedBindings): void;
    get(namedParameters?: NamedBindings): ReturnType | null;
    all(namedParameters?: NamedBindings): ReturnType[];
    values(namedParameters?: NamedBindings): unknown[][];
  }

  interface Database {
    run(sql: string, namedParameters?: NamedBindings): void;
    query<ReturnType = unknown>(sql: string): Statement<ReturnType>;
    prepare<ReturnType = unknown>(sql: string): Statement<ReturnType>;
  }
}
