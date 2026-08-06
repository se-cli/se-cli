import * as fs from 'fs';
import * as path from 'path';
import { SessionConfig } from './registry';

/**
 * Daemon startup cleanup — rolling cleanup of stale session files, old log
 * backups, and (optionally) old screenshots.
 *
 * se-cli's temporary directories accumulate historical files over time:
 *  - `*.session` files survive crashes / force-kills because `se-cli close`
 *    only removes the current session's file (see src/session.ts stop()).
 *  - Log files rotate by size (2 MB x 2 backups, see src/logger.ts) but
 *    backups are never removed by age.
 *  - `<project>/.se-cli/*.png` screenshots use unique timestamp filenames
 *    and never get cleaned.
 *
 * This module implements a Playwright-style garbage collection: only
 * sessions whose recorded daemon `pid` is no longer alive AND that are
 * older than `maxAgeDays` are removed — active sessions are never touched.
 */

export interface CleanupOptions {
  /** Daemon base dir containing `<wsHash>/*.session` subdirs and `logs/`. */
  baseDir: string;
  /** Delete orphan sessions older than this many days. Default 7. */
  maxAgeDays?: number;
  /** Delete log backups older than this many days. Default 7. */
  logMaxAgeDays?: number;
  /** Optional project screenshot dir (`<cwd>/.se-cli`). If unset, screenshots are never cleaned. */
  screenshotDir?: string;
  /** Delete screenshots older than this many days. 0 / unset disables screenshot cleanup. */
  screenshotMaxAgeDays?: number;
}

export interface CleanupResult {
  removedSessions: number;
  removedLogs: number;
  removedScreenshots: number;
}

const DEFAULT_MAX_AGE_DAYS = 7;
const MS_PER_DAY = 24 * 3600 * 1000;

function ageMs(ts: number): number {
  return Date.now() - ts;
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    // ESRCH = no such process; EPERM = exists but owned by another user
    return e.code === 'EPERM';
  }
}

function isExpired(mtimeMs: number, maxAgeDays: number): boolean {
  return ageMs(mtimeMs) > maxAgeDays * MS_PER_DAY;
}

function removeRecursive(dir: string): boolean {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return !fs.existsSync(dir);
  } catch {
    return false;
  }
}

/** Remove orphaned session workspace dirs under baseDir. Returns count removed. */
function cleanupSessions(baseDir: string, maxAgeDays: number): number {
  let removed = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return 0; // baseDir missing / unreadable
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const wsDir = path.join(baseDir, entry.name);
    let files: fs.Dirent[];
    try {
      files = fs.readdirSync(wsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    const sessionFiles = files.filter((f) => f.isFile() && f.name.endsWith('.session'));
    if (sessionFiles.length === 0) continue;

    // File-granular cleanup: a session is orphaned when its daemon pid is
    // dead (or unverifiable) AND it is older than maxAgeDays. Recent or
    // alive sessions are kept — never touch an active daemon.
    let removedHere = 0;
    for (const f of sessionFiles) {
      const file = path.join(wsDir, f.name);
      let config: SessionConfig | null = null;
      try {
        config = JSON.parse(fs.readFileSync(file, 'utf8')) as SessionConfig;
      } catch {
        // Corrupted session file: no pid to verify — treat as orphan.
      }
      if (config) {
        if (config.pid !== undefined && isPidAlive(config.pid)) continue;
        if (config.timestamp && !isExpired(config.timestamp, maxAgeDays)) continue;
      }
      try {
        fs.rmSync(file, { force: true });
        removedHere++;
      } catch {
        // skip unreadable
      }
    }
    removed += removedHere;

    // Remove the now-empty workspace dir (plus any leftover junk) so the
    // registry does not accumulate empty wsHash dirs.
    if (removedHere > 0) {
      try {
        const remaining = fs.readdirSync(wsDir);
        if (remaining.length === 0) removeRecursive(wsDir);
      } catch {
        // skip
      }
    }
  }
  return removed;
}

/** Remove log backup files (name ends with .<n>) older than maxAgeDays. */
function cleanupLogs(baseDir: string, maxAgeDays: number): number {
  const logsDir = path.join(baseDir, 'logs');
  let files: fs.Dirent[];
  try {
    files = fs.readdirSync(logsDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const f of files) {
    if (!f.isFile()) continue;
    // Only age-based cleanup of rotated backups: active logs (no `.N` suffix)
    // are kept even if old — the FileLogger rotates them by size.
    if (!/\.\d+$/.test(f.name)) continue;
    const file = path.join(logsDir, f.name);
    try {
      const st = fs.statSync(file);
      if (isExpired(st.mtimeMs, maxAgeDays)) {
        fs.rmSync(file, { force: true });
        removed++;
      }
    } catch {
      // skip unreadable
    }
  }
  return removed;
}

/** Remove screenshots older than maxAgeDays in screenshotDir (if configured). */
function cleanupScreenshots(dir: string | undefined, maxAgeDays: number): number {
  if (!dir || maxAgeDays <= 0) return 0;
  let files: fs.Dirent[];
  try {
    files = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const f of files) {
    if (!f.isFile() || !/\.png$/i.test(f.name)) continue;
    const file = path.join(dir, f.name);
    try {
      const st = fs.statSync(file);
      if (isExpired(st.mtimeMs, maxAgeDays)) {
        fs.rmSync(file, { force: true });
        removed++;
      }
    } catch {
      // skip unreadable
    }
  }
  return removed;
}

/**
 * Run the startup cleanup pass. Best-effort: individual failures are
 * swallowed so a cleanup error never prevents the daemon from starting.
 */
export function runCleanup(opts: CleanupOptions): CleanupResult {
  const maxAgeDays = opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const logMaxAgeDays = opts.logMaxAgeDays ?? maxAgeDays;
  const screenshotMaxAgeDays = opts.screenshotMaxAgeDays ?? 0;

  return {
    removedSessions: cleanupSessions(opts.baseDir, maxAgeDays),
    removedLogs: cleanupLogs(opts.baseDir, logMaxAgeDays),
    removedScreenshots: cleanupScreenshots(opts.screenshotDir, screenshotMaxAgeDays),
  };
}
