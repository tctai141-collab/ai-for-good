import App from "./App";
import ErrorBoundary from "./ErrorBoundary";

/**
 * The single island the page mounts.
 *
 * This exists because the obvious spelling does not work. Writing
 *
 *   <ErrorBoundary client:only="react"><App client:only="react" /></ErrorBoundary>
 *
 * in the .astro page produces two separate islands, each hydrated on its own.
 * App is not a React child of the boundary, so the boundary never sees it
 * throw — verified by forcing a render failure and watching the page go black
 * anyway, exactly as it did before the boundary existed.
 *
 * One component, one island, one React tree, and the boundary is genuinely
 * above everything it is supposed to catch.
 */
export default function Root() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
