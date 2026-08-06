import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { baseDaemonDir } from '../../src/config';

const execFileAsync = promisify(execFile);
const CLI = path.join(__dirname, '..', '..', 'dist', 'cli.js');

// Isolated LOCALAPPDATA so the cleanup integration test never touches the
// real daemon registry. baseDaemonDir() reads LOCALAPPDATA (config.ts).
let isoRoot: string;
let isoAppData: string;

beforeAll(() => {
  isoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cleanup-e2e-'));
  isoAppData = path.join(isoRoot, 'appdata');
  fs.mkdirSync(isoAppData, { recursive: true });
  // Point the TEST process at the isolated dir so baseDaemonDir() resolves
  // to the same location the spawned daemon (which inherits LOCALAPPDATA
  // from the CLI process, which inherits from this test's env) uses.
  process.env.LOCALAPPDATA = isoAppData;
});

afterAll(() => {
  fs.rmSync(isoRoot, { recursive: true, force: true });
});

async function run(args: string[], env: Record<string, string>): Promise<string> {
  const { stdout } = await execFileAsync('node', [CLI, ...args], {
    encoding: 'utf8',
    timeout: 90000,
    env: { ...process.env, ...env, LOCALAPPDATA: isoAppData, SE_CLI_SESSION: 'cleanup-test' },
    shell: false,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

describe('daemon startup cleanup (issue #115)', () => {
  // A dead pid for orphan simulation: spawn a child that exits immediately.
  function deadPid(): number {
    return spawn(process.execPath, ['-e', ''], { stdio: 'ignore' }).pid as number;
  }

  let sessionCounter = 0;

  // Unique session per test so a daemon from a previous test is never
  // reused (reuse would skip the startup cleanup pass we are testing).
  function sessionName(): string {
    sessionCounter++;
    return `cleanup-${Date.now().toString(36)}-${sessionCounter}`;
  }

  async function openDaemon(): Promise<string> {
    const sess = sessionName();
    await run(['open', `--browser=edge`], { SE_CLI_SESSION: sess });
    return sess;
  }

  it('sweeps orphaned session files from crashed daemons on startup', async () => {
    const daemonDir = baseDaemonDir(); // under isoAppData
    const wsHash = 'deadbeef' + Date.now().toString(16);
    const wsDir = path.join(daemonDir, wsHash);
    fs.mkdirSync(wsDir, { recursive: true });

    const orphanPid = deadPid();
    // Wait for the child to exit so the pid is definitely dead.
    await new Promise((r) => setTimeout(r, 300));
    fs.writeFileSync(
      path.join(wsDir, 'default.session'),
      JSON.stringify({
        name: 'default', version: '0.9.2', timestamp: Date.now() - 30 * 24 * 3600 * 1000,
        socketPath: 'x', workspaceDir: '/tmp', persistent: false, browserName: 'chrome', pid: orphanPid,
      }),
    );

    // Starting a fresh daemon triggers the startup cleanup pass.
    const sess = await openDaemon();

    expect(fs.existsSync(wsDir)).toBe(false); // orphan workspace swept

    // Shut the daemon down so later tests get a fresh startup.
    await run(['close'], { SE_CLI_SESSION: sess });
  });

  it('keeps live sessions untouched during startup cleanup', async () => {
    const daemonDir = baseDaemonDir();
    const wsHash = 'live' + Date.now().toString(16);
    const wsDir = path.join(daemonDir, wsHash);
    fs.mkdirSync(wsDir, { recursive: true });
    fs.writeFileSync(
      path.join(wsDir, 'default.session'),
      JSON.stringify({
        name: 'default', version: '0.9.2', timestamp: Date.now() - 30 * 24 * 3600 * 1000,
        socketPath: 'x', workspaceDir: '/tmp', persistent: false, browserName: 'chrome', pid: process.pid,
      }),
    );

    const sess = await openDaemon();

    expect(fs.existsSync(path.join(wsDir, 'default.session'))).toBe(true); // live pid kept

    await run(['close'], { SE_CLI_SESSION: sess });
  });
});
