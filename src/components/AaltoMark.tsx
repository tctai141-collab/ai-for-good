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
 */
export default function AaltoMark({
  height = 22,
  className = "",
}: {
  height?: number;
  className?: string;
}) {
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");
  if (state === "missing") return null;

  return (
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
  );
}
