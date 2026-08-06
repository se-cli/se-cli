import { describe, it, expect, afterEach } from 'vitest';
import { computeShardPlan, parseShard, ShardPlan, gridStatus, formatGridStatus } from '../../src/grid';

describe('parseShard', () => {
  it('parses x/y format', () => {
    expect(parseShard('2/5')).toEqual({ index: 2, total: 5 });
  });

  it('throws on missing slash', () => {
    expect(() => parseShard('2')).toThrow(/format/i);
    expect(() => parseShard('')).toThrow(/format/i);
  });

  it('throws on zero or negative total', () => {
    expect(() => parseShard('1/0')).toThrow(/positive/i);
    expect(() => parseShard('1/-3')).toThrow(/positive/i);
  });

  it('throws when index is out of range or not an integer', () => {
    expect(() => parseShard('0/3')).toThrow(/1.*3|range/i);
    expect(() => parseShard('4/3')).toThrow(/range/i);
    expect(() => parseShard('a/3')).toThrow(/integer/i);
  });
});

describe('computeShardPlan', () => {
  const browsers = ['chrome', 'firefox', 'edge'];

  it('splits a list into y shards and returns the x-th', () => {
    // 3 items over 3 shards → each shard gets 1 item (round-robin)
    const plan = computeShardPlan(browsers, { index: 1, total: 3 });
    expect(plan.items).toEqual(['chrome']);
    expect(plan.total).toBe(3);
    expect(plan.index).toBe(1);
    expect(computeShardPlan(browsers, { index: 2, total: 3 }).items).toEqual(['firefox']);
    expect(computeShardPlan(browsers, { index: 3, total: 3 }).items).toEqual(['edge']);
  });

  it('distributes remainder round-robin (earlier shards get extras)', () => {
    // 3 items over 2 shards → shard 1 gets 2, shard 2 gets 1
    const s1 = computeShardPlan(browsers, { index: 1, total: 2 });
    expect(s1.items).toEqual(['chrome', 'edge']);
    const s2 = computeShardPlan(browsers, { index: 2, total: 2 });
    expect(s2.items).toEqual(['firefox']);
  });

  it('supports more shards than items (some shards empty)', () => {
    const plan = computeShardPlan(browsers, { index: 4, total: 5 });
    expect(plan.items).toEqual([]);
  });
});

describe('gridStatus', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(impl: (url: string) => Promise<{ ok: boolean; status?: number; json: () => Promise<any> }>) {
    globalThis.fetch = impl as any;
  }

  it('parses a healthy Grid 4 /status payload', async () => {
    mockFetch(async () => ({
      ok: true,
      json: async () => ({
        value: {
          ready: true,
          message: 'Selenium Grid ready.',
          nodes: [
            { id: 'n1', maxSession: 5, sessionCount: 2, slots: { chrome: {}, firefox: {} } },
            { id: 'n2', maxSession: 5, sessionCount: 0, slots: { chrome: {}, edge: {} } },
          ],
        },
      }),
    }));

    const s = await gridStatus('http://grid:4444/wd/hub', { timeoutMs: 5000 });

    expect(s.ok).toBe(true);
    expect(s.ready).toBe(true);
    expect(s.nodes).toBe(2);
    expect(s.totalSlots).toBe(10);
    expect(s.sessionCount).toBe(2);
    expect(s.browsers).toEqual(['chrome', 'edge', 'firefox']);
  });

  it('normalizes URLs with trailing slash or /status suffix', async () => {
    mockFetch(async (url: string) => ({
      ok: true,
      json: async () => ({ value: { ready: false, nodes: [] } }),
    }));

    const a = await gridStatus('http://grid:4444/', { timeoutMs: 1000 });
    expect(a.gridUrl).toBe('http://grid:4444');
    const b = await gridStatus('http://grid:4444/wd/hub/status', { timeoutMs: 1000 });
    expect(b.gridUrl).toBe('http://grid:4444/wd/hub');
  });

  it('reports non-ok HTTP as not ok', async () => {
    mockFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));

    const s = await gridStatus('http://grid:4444', { timeoutMs: 1000 });

    expect(s.ok).toBe(false);
    expect(s.message).toBe('HTTP 503');
  });

  it('catches network errors and reports them', async () => {
    mockFetch(async () => {
      throw new Error('fetch failed: ECONNREFUSED');
    });

    const s = await gridStatus('http://grid:4444', { timeoutMs: 1000 });

    expect(s.ok).toBe(false);
    expect(s.message).toMatch(/ECONNREFUSED/);
  });

  it('reports timeouts distinctly (AbortError)', async () => {
    mockFetch(async () => {
      const e: any = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    });

    const s = await gridStatus('http://grid:4444', { timeoutMs: 500 });

    expect(s.ok).toBe(false);
    expect(s.message).toContain('timeout');
  });
});

describe('formatGridStatus', () => {
  it('renders a healthy grid summary', () => {
    const text = formatGridStatus({
      ok: true, gridUrl: 'http://grid:4444', ready: true,
      nodes: 2, totalSlots: 10, sessionCount: 3, browsers: ['chrome', 'firefox'],
    });
    expect(text).toContain('Grid: http://grid:4444');
    expect(text).toContain('Status: ready');
    expect(text).toContain('Nodes: 2');
    expect(text).toContain('Total slots: 10');
    expect(text).toContain('Browsers: chrome, firefox');
  });

  it('renders a not-ready grid with no message and no browsers', () => {
    const text = formatGridStatus({
      ok: true, gridUrl: 'http://grid:4444', ready: false,
      nodes: 0, totalSlots: 0, sessionCount: 0, browsers: [],
    });
    expect(text).toContain('Status: not ready');
    expect(text).not.toContain('Browsers:');
  });

  it('renders an unreachable grid', () => {
    const text = formatGridStatus({ ok: false, gridUrl: 'http://x', ready: false, nodes: 0, totalSlots: 0, sessionCount: 0, message: 'timeout' });
    expect(text).toContain('Grid unreachable: timeout');
    const noMsg = formatGridStatus({ ok: false, gridUrl: 'http://x', ready: false, nodes: 0, totalSlots: 0, sessionCount: 0 });
    expect(noMsg).toContain('unknown error');
  });
});
