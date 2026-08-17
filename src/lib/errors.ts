/**
 * Error reporting.
 *
 * The app had two console.error calls in the whole codebase and no alerting, so
 * the only signal that something had broken was a founder saying so. That is
 * not good enough for a system holding people's private reflections, where a
 * silent failure can look exactly like a founder who has gone quiet.
 *
 * Sends to Sentry's store endpoint over plain HTTP rather than pulling in the
 * SDK. The SDK's value is automatic instrumentation of a large surface; this is
 * one server with a handful of routes, and a dependency that ships its own
 * transport, integrations and bundler plugins is not worth it here.
 *
 * Unconfigured, everything below degrades to console logging.
 */

type Level = "error" | "warning" | "info";

type Parsed = { url: string; publicKey: string; projectId: string };

let parsed: Parsed | null | undefined;

/**
 * Splits a DSN into the pieces the store endpoint needs.
 * Format: https://<publicKey>@<host>/<projectId>
 */
function dsn(): Parsed | null {
  if (parsed !== undefined) return parsed;

  const raw = process.env.SENTRY_DSN?.trim();
  if (!raw) {
    parsed = null;
    return parsed;
  }

  try {
    const url = new URL(raw);
    const projectId = url.pathname.replace(/^\//, "");
    if (!url.username || !projectId) throw new Error("missing key or project id");
    parsed = {
      url: `${url.protocol}//${url.host}/api/${projectId}/store/`,
      publicKey: url.username,
      projectId,
    };
  } catch (error) {
    console.error("[errors] SENTRY_DSN is not a valid DSN; error reporting is off:", error);
    parsed = null;
  }
  return parsed;
}

export function isErrorReportingConfigured(): boolean {
  return dsn() !== null;
}

/**
 * Reports an error. Never throws and never blocks the caller — a failure to
 * report must not turn into a failure to serve.
 */
export function reportError(
  error: unknown,
  context: { where: string; level?: Level; extra?: Record<string, unknown> } = { where: "unknown" },
): void {
  const level = context.level ?? "error";
  const message = error instanceof Error ? error.message : String(error);

  // Always log locally; Render captures stdout regardless of whether Sentry is set up.
  const log = level === "error" ? console.error : console.warn;
  log(`[${context.where}]`, message, context.extra ?? "");

  const target = dsn();
  if (!target) return;

  const payload = {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: new Date().toISOString(),
    platform: "javascript",
    level,
    logger: context.where,
    server_name: "sprint-buddy",
    environment: process.env.NODE_ENV ?? "development",
    exception: {
      values: [
        {
          type: error instanceof Error ? error.name : "Error",
          value: message,
          stacktrace: error instanceof Error && error.stack
            ? { frames: framesFrom(error.stack) }
            : undefined,
        },
      ],
    },
    // Deliberately narrow. Never attach request bodies, cookies or user
    // content — this is a privacy-sensitive app and an error tracker is a
    // third party. Where it happened and what broke, nothing more.
    extra: context.extra,
  };

  void fetch(target.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sentry-Auth": [
        "Sentry sentry_version=7",
        "sentry_client=sprint-buddy/1.0",
        `sentry_key=${target.publicKey}`,
      ].join(", "),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5_000),
  }).catch((sendError) => {
    console.error("[errors] could not deliver report:", sendError);
  });
}

/** Sentry wants frames oldest-first; a JS stack is newest-first. */
function framesFrom(stack: string) {
  return stack
    .split("\n")
    .slice(1, 30)
    .map((line) => ({ filename: line.trim() }))
    .reverse();
}
