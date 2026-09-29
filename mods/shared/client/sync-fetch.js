const DEFAULT_SYNC_BASE_URL = "http://127.0.0.1:8787";

/** Fetch a path from the local sync server in browsers or Node with global fetch. */
export function syncFetch(path, init) {
  const base = (globalThis.SYNC_BASE_URL || DEFAULT_SYNC_BASE_URL).replace(/\/$/, "");
  const route = String(path).startsWith("/") ? String(path) : `/${path}`;
  return globalThis.fetch(`${base}${route}`, init);
}
