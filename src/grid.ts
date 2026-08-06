/**
 * Selenium Grid management (v0.10, issue #21 / roadmap "grid status /
 * grid attach / grid distribute").
 *
 * Pure helpers for grid status queries and shard planning; the HTTP
 * /status query lives in the CLI layer (program.ts) so this module stays
 * unit-testable without a live Grid.
 */

export interface ShardSpec {
  /** 1-based shard index (1..total). */
  index: number;
  /** Total number of shards. */
  total: number;
}

export interface ShardPlan {
  index: number;
  total: number;
  items: string[];
}

/**
 * Parse a `--shard=<x>/<y>` value into a ShardSpec.
 * Validates: format "x/y", positive total, integer index within 1..total.
 */
export function parseShard(input: string): ShardSpec {
  const parts = String(input).trim().split('/');
  if (parts.length !== 2) {
    throw new Error('Invalid --shard format. Expected "<index>/<total>", e.g. --shard=1/4');
  }
  const index = Number(parts[0]);
  const total = Number(parts[1]);
  if (!Number.isInteger(index) || !Number.isInteger(total)) {
    throw new Error('--shard index and total must be integers');
  }
  if (total <= 0) {
    throw new Error('--shard total must be a positive integer');
  }
  if (index < 1 || index > total) {
    throw new Error(`--shard index must be in the range 1..${total}`);
  }
  return { index, total };
}

/**
 * Split a list of items across `total` shards round-robin (item i belongs
 * to shard (i % total) + 1) and return the `index`-th shard.
 */
export function computeShardPlan(items: string[], spec: ShardSpec): ShardPlan {
  const selected: string[] = [];
  for (let i = 0; i < items.length; i++) {
    if ((i % spec.total) + 1 === spec.index) selected.push(items[i]);
  }
  return {
    index: spec.index,
    total: spec.total,
    items: selected,
  };
}

// --- Grid status (Selenium Grid 4 /status) ---

export interface GridStatus {
  ok: boolean;
  gridUrl: string;
  ready: boolean;
  message?: string;
  nodes: number;
  totalSlots: number;
  sessionCount: number;
  browsers: string[];
  raw?: unknown;
}

export interface GridStatusOptions {
  /** HTTP request timeout in ms (default 10000). */
  timeoutMs?: number;
}

function normalizeGridUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/status') ? trimmed.slice(0, -'/status'.length) : trimmed;
}

/**
 * Query a Selenium Grid 4 hub's /status endpoint and parse the summary.
 * Returns a best-effort result; on network/parse failure `ok` is false and
 * the error message is exposed for the CLI to print.
 */
export async function gridStatus(
  gridUrl: string,
  opts: GridStatusOptions = {},
): Promise<GridStatus> {
  const base = normalizeGridUrl(gridUrl);
  const timeoutMs = opts.timeoutMs ?? 10000;
  const result: GridStatus = {
    ok: false,
    gridUrl: base,
    ready: false,
    nodes: 0,
    totalSlots: 0,
    sessionCount: 0,
    browsers: [],
  };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(`${base}/status`, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) {
      result.message = `HTTP ${resp.status}`;
      return result;
    }
    const data = (await resp.json()) as any;
    const value = data?.value ?? {};
    result.ready = value.ready === true;
    result.message = typeof value.message === 'string' ? value.message : undefined;
    const nodes = Array.isArray(value.nodes) ? value.nodes : [];
    result.nodes = nodes.length;
    const browsers = new Set<string>();
    let slots = 0;
    let sessions = 0;
    for (const node of nodes) {
      const slotMap = node?.slots ?? {};
      for (const key of Object.keys(slotMap)) browsers.add(key);
      if (typeof node?.maxSession === 'number') slots += node.maxSession;
      if (typeof node?.sessionCount === 'number') sessions += node.sessionCount;
    }
    result.totalSlots = slots;
    result.sessionCount = sessions;
    result.browsers = [...browsers].sort();
    result.raw = data;
    result.ok = true;
  } catch (e: any) {
    result.message = e.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : e.message;
  }
  return result;
}

/** Human-readable rendering of a grid status result. */
export function formatGridStatus(s: GridStatus): string {
  if (!s.ok) {
    return `Grid unreachable: ${s.message ?? 'unknown error'} (${s.gridUrl})`;
  }
  const lines: string[] = [
    `Grid: ${s.gridUrl}`,
    `Status: ${s.ready ? 'ready' : 'not ready'}${s.message ? ` — ${s.message}` : ''}`,
    `Nodes: ${s.nodes}`,
    `Total slots: ${s.totalSlots}`,
    `Active sessions: ${s.sessionCount}`,
  ];
  if (s.browsers.length > 0) lines.push(`Browsers: ${s.browsers.join(', ')}`);
  return lines.join('\n');
}
