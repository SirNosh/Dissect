/** Stand-in for `cloudflare:workers` when prerendering the static GitHub Pages build. */
export const env: Record<string, unknown> = {};

export function waitUntil(_promise: Promise<unknown>): void {}
