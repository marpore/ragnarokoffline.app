let initialized = false;

// Extension Hooks will later use the shared syncFetch helper for Sentry APIs.
export default function init() {
  if (initialized) return;
  initialized = true;
  console.info("[alerts-board] stub ready");
  return true;
}
