import * as fs from 'fs';
import * as path from 'path';

export interface SessionConfig {
  name: string;
  version: string;
  timestamp: number;
  socketPath: string;
  workspaceDir: string;
  persistent: boolean;
  browserName: 'chrome' | 'edge' | 'firefox' | 'safari' | 'electron';
  headed?: boolean;
  cdpEndpoint?: string;
  profilePath?: string;
  idleTimeout?: number;
  // v0.8: open-time emulation flags (viewport/UA/locale/color-scheme/
  // timezone/geolocation/permissions), replayed after a driver rebuild.
  emulation?: Record<string, any>;
  pid?: number;
}

export interface AllSessionsEntry {
  wsHash: string;
  config: SessionConfig;
}

export class Registry {
  constructor(private baseDir: string) {}

  private sessionFile(wsHash: string, sessionName: string): string {
    return path.join(this.baseDir, wsHash, `${sessionName}.session`);
  }

  writeSession(wsHash: string, config: SessionConfig): void {
    const file = this.sessionFile(wsHash, config.name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(config, null, 2));
  }

  loadSession(wsHash: string, sessionName: string): SessionConfig | null {
    const file = this.sessionFile(wsHash, sessionName);
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return data as SessionConfig;
    } catch {
      return null;
    }
  }

  listSessions(wsHash: string): SessionConfig[] {
    const dir = path.join(this.baseDir, wsHash);
    if (!fs.existsSync(dir)) return [];
    const sessions: SessionConfig[] = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.session')) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        sessions.push(data as SessionConfig);
      } catch {
        // skip invalid files
      }
    }
    return sessions;
  }

  /**
   * List sessions across ALL workspaces (used by `se-cli sessions` /
   * `se-cli close --all`). The registry base dir contains one subdirectory
   * per workspace hash, each holding *.session files.
   */
  listAllSessions(): AllSessionsEntry[] {
    if (!fs.existsSync(this.baseDir)) return [];
    const entries: AllSessionsEntry[] = [];
    for (const wsHash of fs.readdirSync(this.baseDir)) {
      const dir = path.join(this.baseDir, wsHash);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const session of this.listSessions(wsHash)) {
        entries.push({ wsHash, config: session });
      }
    }
    return entries;
  }

  deleteSession(wsHash: string, sessionName: string): void {
    const file = this.sessionFile(wsHash, sessionName);
    try {
      fs.unlinkSync(file);
    } catch {
      // ignore
    }
  }
}
