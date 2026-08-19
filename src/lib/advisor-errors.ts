/**
 * Turning a failed advisor request into something a founder can act on.
 *
 * Every non-OK response used to become the same sentence: "Could not reach your
 * advisor just now. Check your connection and try again." That names a network
 * fault. When the real cause was a 403 from the cross-site check, the message
 * sent everyone — including me — looking at connectivity while the server sat
 * there refusing requests perfectly happily. The person reading it also has no
 * reason to reload, which is the one thing that would have fixed it.
 *
 * A status code is not a diagnosis, but it is enough to say which kind of thing
 * went wrong and what the founder should do next.
 */

/** null means the request never got a response at all. */
export function advisorErrorMessage(status: number | null): string {
  if (status === null) {
    return "Could not reach the server. Check your connection and try again.";
  }
  if (status === 401) {
    return "Your session has expired. Reload the page and sign in again.";
  }
  if (status === 403) {
    return "The server refused that request. Reloading the page usually fixes it.";
  }
  if (status === 413) {
    return "That message is too long. Try a shorter one.";
  }
  if (status === 429) {
    return "That is faster than the advisor can answer. Give it a minute.";
  }
  if (status >= 500) {
    return "The advisor is unavailable right now. Try again in a moment.";
  }
  return "Something went wrong sending that. Try again.";
}
