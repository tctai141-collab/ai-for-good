import React from "react";

/**
 * The last line before a black rectangle.
 *
 * There was no boundary anywhere in this app, which meant any throw during
 * render unmounted the entire tree and left the founder looking at the
 * background colour. Reproduced before writing this: a 200 response from
 * /api/deadlines whose body happened to lack one field took the whole page out,
 * with no message, no console output a founder would ever see, and no recovery
 * short of a reload that failed the same way.
 *
 * That is the wrong failure for this product. A founder who cannot open Sprint
 * Buddy during the sprint has no way to tell whether their own writing is still
 * there, and no way to ask.
 *
 * Deliberately plain: this renders when something has already gone wrong, so it
 * uses no tokens, no fonts and no components that could be the thing that is
 * broken. Inline styles and system fonts only.
 */

type Props = { children: React.ReactNode };
type State = { failed: boolean };

export default class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo) {
    /* console, not reportError. That helper reads process.env for the Sentry
       DSN, which does not exist in a browser bundle — calling it here would
       throw inside the one handler that must not throw. Shipping browser
       errors to the server would need its own endpoint and its own decision
       about what a founder's stack trace contains; this at least leaves a
       record for anyone who opens the console. */
    console.error("[render]", error, info.componentStack);
  }

  override render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          background: "#08090a",
          color: "#f7f8f8",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "left" }}>
          <h1 style={{ margin: "0 0 10px", fontSize: 19, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Sprint Buddy could not draw this page.
          </h1>
          <p style={{ margin: "0 0 18px", fontSize: 14, lineHeight: 1.6, color: "#d0d6e0" }}>
            Nothing you have written is affected. It is stored on the server, not
            in this page. Reloading usually clears it.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              minHeight: 36,
              padding: "0 16px",
              border: 0,
              borderRadius: 8,
              background: "#5e6ad2",
              color: "#f7f8f8",
              font: "600 14px/1 inherit",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          <p style={{ margin: "18px 0 0", fontSize: 12.5, lineHeight: 1.6, color: "#8a8f98" }}>
            If it keeps happening, tell the operating team what you were doing
            when it started.
          </p>
        </div>
      </div>
    );
  }
}
