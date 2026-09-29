let initialized = false;

// Extension Hooks will later use the shared syncFetch helper for ticket APIs.
export default function init() {
  if (initialized) return;
  initialized = true;
  console.info("[linear-mobs] stub ready");
  return true;
}
