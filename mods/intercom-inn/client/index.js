let initialized = false;

// Extension Hooks will later use the shared syncFetch helper for Intercom APIs.
export default function init() {
  if (initialized) return;
  initialized = true;
  console.info("[intercom-inn] stub ready");
  return true;
}
