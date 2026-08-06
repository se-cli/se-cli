import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runCleanup } from '../../src/cleanup';

describe('runCleanup', () => {
  let baseDir: string;
  let oldTs: number;
  let now: number;

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-cleanup-'));
    now = Date.now();
    oldTs = now - 30 * 24 * 3600 * 1000; // 30 days ago
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  function writeSession(wsHash: string, name: string, overrides: Record<string, any> = {}): string {
    const dir = path.join(baseDir, wsHash);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}.session`);
    const config = {
      name,
      version: '0.9.2',
      timestamp: now,
      socketPath: 'pipe-test',
      workspaceDir: '/tmp',
      persistent: false,
      browserName: 'chrome',
      pid: process.pid, // alive pid by default
      ...overrides,
    };
    fs.writeFileSync(file, JSON.stringify(config, null, 2));
    return file;
  }

  it('removes orphan sessions whose pid is dead and older than maxAgeDays', () => {
    // dead pid: spawn a child, let it exit
    const { spawnSync } = require('child_process') as typeof import('child_process');
    const dead = spawnSync(process.execPath, ['-e', '']).pid; // exited immediately

    writeSession('ws1', 'orphan', { pid: dead, timestamp: oldTs });
    writeSession('ws1', 'recent-dead', { pid: dead, timestamp: now });

    const result = runCleanup({ baseDir, maxAgeDays: 7 });

    expect(result.removedSessions).toBe(1);
    // orphan deleted (dead pid + old), recent-dead kept (dead pid but recent)
    expect(fs.existsSync(path.join(baseDir, 'ws1', 'orphan.session'))).toBe(false);
    expect(fs.existsSync(path.join(baseDir, 'ws1', 'recent-dead.session'))).toBe(true);
  });

  it('keeps sessions whose pid is still alive regardless of age', () => {
    writeSession('ws1', 'alive-old', { pid: process.pid, timestamp: oldTs });

    const result = runCleanup({ baseDir, maxAgeDays: 7 });

    expect(result.removedSessions).toBe(0);
    expect(fs.existsSync(path.join(baseDir, 'ws1', 'alive-old.session'))).toBe(true);
  });

  it('removes the whole workspace dir when all its sessions are orphaned', () => {
    const { spawnSync } = require('child_process') as typeof import('child_process');
    const dead = spawnSync(process.execPath, ['-e', '']).pid;

    writeSession('ws-dead', 'a', { pid: dead, timestamp: oldTs });
    writeSession('ws-dead', 'b', { pid: dead, timestamp: oldTs });

    const result = runCleanup({ baseDir, maxAgeDays: 7 });

    expect(result.removedSessions).toBe(2);
    expect(fs.existsSync(path.join(baseDir, 'ws-dead'))).toBe(false);
  });

  it('tolerates corrupted session files without crashing', () => {
    const dir = path.join(baseDir, 'ws-corrupt');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'broken.session'), 'not-json{{{');

    const result = runCleanup({ baseDir, maxAgeDays: 7 });

    // corrupt file: no pid to check — treat as orphan and remove
    expect(result.removedSessions).toBe(1);
    expect(fs.existsSync(path.join(baseDir, 'ws-corrupt'))).toBe(false);
  });

  it('cleans old log backup files but keeps the active log', () => {
    const logsDir = path.join(baseDir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(path.join(logsDir, 'active.daemon.log'), 'x');
    fs.writeFileSync(path.join(logsDir, 'active.daemon.log.1'), 'x');
    fs.writeFileSync(path.join(logsDir, 'old.daemon.log.2'), 'x');
    // set old mtimes
    const old = new Date(oldTs);
    fs.utimesSync(path.join(logsDir, 'active.daemon.log.1'), old, old);
    fs.utimesSync(path.join(logsDir, 'old.daemon.log.2'), old, old);

    const result = runCleanup({ baseDir, maxAgeDays: 7 });

    expect(result.removedLogs).toBe(2);
    // active log kept, .1 backup kept if recent... wait .1 is old -> removed
    expect(fs.existsSync(path.join(logsDir, 'active.daemon.log'))).toBe(true);
    expect(fs.existsSync(path.join(logsDir, 'active.daemon.log.1'))).toBe(false);
    expect(fs.existsSync(path.join(logsDir, 'old.daemon.log.2'))).toBe(false);
  });

  it('cleans old screenshots when enabled, keeps recent ones', () => {
    const shotDir = path.join(baseDir, 'shots');
    fs.mkdirSync(shotDir, { recursive: true });
    fs.writeFileSync(path.join(shotDir, 'old.png'), 'x');
    fs.writeFileSync(path.join(shotDir, 'recent.png'), 'x');
    const old = new Date(oldTs);
    fs.utimesSync(path.join(shotDir, 'old.png'), old, old);

    const result = runCleanup({ baseDir, screenshotDir: shotDir, screenshotMaxAgeDays: 7 });

    expect(result.removedScreenshots).toBe(1);
    expect(fs.existsSync(path.join(shotDir, 'old.png'))).toBe(false);
    expect(fs.existsSync(path.join(shotDir, 'recent.png'))).toBe(true);
  });

  it('does not touch screenshots when screenshot cleanup is disabled (default)', () => {
    const shotDir = path.join(baseDir, 'shots');
    fs.mkdirSync(shotDir, { recursive: true });
    fs.writeFileSync(path.join(shotDir, 'old.png'), 'x');
    const old = new Date(oldTs);
    fs.utimesSync(path.join(shotDir, 'old.png'), old, old);

    const result = runCleanup({ baseDir, screenshotDir: shotDir });

    expect(result.removedScreenshots).toBe(0);
    expect(fs.existsSync(path.join(shotDir, 'old.png'))).toBe(true);
  });

  it('returns zero counts when baseDir does not exist', () => {
    const result = runCleanup({ baseDir: path.join(baseDir, 'nope'), maxAgeDays: 7 });
    expect(result).toEqual({ removedSessions: 0, removedLogs: 0, removedScreenshots: 0 });
  });

  it('keeps sessions whose pid is invalid (non-positive) but recent, removes old invalid-pid ones', () => {
    writeSession('ws-invalid', 'old', { pid: -1, timestamp: oldTs });
    writeSession('ws-invalid', 'recent', { pid: 0, timestamp: now });

    const result = runCleanup({ baseDir, maxAgeDays: 7 });

    expect(result.removedSessions).toBe(1);
    expect(fs.existsSync(path.join(baseDir, 'ws-invalid', 'old.session'))).toBe(false);
    expect(fs.existsSync(path.join(baseDir, 'ws-invalid', 'recent.session'))).toBe(true);
  });

  it('handles missing logs dir and missing screenshot dir gracefully', () => {
    const result = runCleanup({
      baseDir,
      maxAgeDays: 7,
      screenshotDir: path.join(baseDir, 'no-shots'),
      screenshotMaxAgeDays: 7,
    });
    expect(result.removedLogs).toBe(0);
    expect(result.removedScreenshots).toBe(0);
  });

  it('skips non-png files and files that fail to stat in screenshot dir', () => {
    const shotDir = path.join(baseDir, 'shots2');
    fs.mkdirSync(shotDir, { recursive: true });
    fs.writeFileSync(path.join(shotDir, 'notes.txt'), 'x');
    const old = new Date(oldTs);
    // directory that will fail statSync when treated as file? use a subdir named .png
    fs.mkdirSync(path.join(shotDir, 'dir.png'), { recursive: true });

    const result = runCleanup({ baseDir, screenshotDir: shotDir, screenshotMaxAgeDays: 7 });

    expect(result.removedScreenshots).toBe(0);
    expect(fs.existsSync(path.join(shotDir, 'notes.txt'))).toBe(true);
  });

  it('ignores non-session files and non-directory entries in baseDir', () => {
    const strayFile = path.join(baseDir, 'stray.txt');
    fs.writeFileSync(strayFile, 'x');
    const { spawnSync } = require('child_process') as typeof import('child_process');
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    writeSession('ws-stray', 'orphan', { pid: dead, timestamp: oldTs });

    const result = runCleanup({ baseDir, maxAgeDays: 7 });

    expect(result.removedSessions).toBe(1);
    expect(fs.existsSync(strayFile)).toBe(true); // stray file untouched
  });
});
