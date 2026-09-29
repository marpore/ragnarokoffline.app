let initialized = false;

// Extension Hooks will later use the shared syncFetch helper for Grok APIs.
export default function init() {
  if (initialized) return;
  initialized = true;
  console.info("[grok-npc] stub ready");
  return true;
}
