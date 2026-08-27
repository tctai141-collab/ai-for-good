import { useState } from "react";

/**
 * The Aalto mark, beside the Sprint Buddy wordmark.
 *
 * No artwork here. The mark is a trademarked asset with approved files and
 * clear-space rules, so this is the slot: drop the reverse-on-dark SVG at
 * public/aalto-logo.svg and it appears in both places at once.
 *
 * It renders nothing until the image says it loaded, and nothing ever again if
 * it says it did not. A broken-image icon beside the product's own wordmark is
 * worse than no logo at all, and the file is genuinely absent until somebody
 * puts it there.
 *
 * The divider belongs to this component, not to the caller.
 *
 * It used to be a `<span>` the caller drew just before the mark. With no file
 * on disk the mark removed itself and the rule did not, so every screen showed
 * "Sprint Buddy" followed by a lone vertical bar separating the wordmark from
 * nothing at all. Anything that only makes sense next to the mark has to
 * disappear with it, so it lives in here and is drawn only once the image has
 * actually loaded.
 */
export default function AaltoMark({
  height = 22,
  className = "",
  rule,
}: {
  height?: number;
  className?: string;
  /** Style for the divider drawn before the mark. Omit for no divider. */
  rule?: React.CSSProperties;
}) {
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");
  if (state === "missing") return null;

  return (
    <>
      {rule && state === "ok" && <span aria-hidden="true" style={rule} />}
      <img
        src="/aalto-logo.svg"
        alt="Aalto University"
        className={`aalto-mark ${className}`.trim()}
        style={{
          height,
          width: "auto",
          maxWidth: 132,
          display: "block",
          opacity: state === "ok" ? 0.62 : 0,
          transition: "opacity 240ms ease",
        }}
        onLoad={() => setState("ok")}
        onError={() => setState("missing")}
      />
    </>
  );
}
