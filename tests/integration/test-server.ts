/**
 * Lightweight HTTP test server for integration tests.
 *
 * Serves static fixture files from `tests/integration/fixtures/` and
 * provides an extensible hook for future dynamic page endpoints.
 *
 * Usage in tests:
 *   import { startTestServer } from './test-server';
 *   const server = await startTestServer();
 *   // server.baseUrl → http://127.0.0.1:<port>
 *   // server.url('forms.html') → http://127.0.0.1:<port>/forms.html
 *   await server.close();
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

export interface TestServer {
  /** Base URL, e.g. `http://127.0.0.1:34567` */
  baseUrl: string;
  /** Build a full URL for a fixture file, e.g. `server.url('forms.html')` */
  url(file: string): string;
  /** Stop the server */
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

/**
 * Optional dynamic route handler.
 * Future features can register dynamic endpoints by mutating this map
 * before calling `startTestServer`.
 *
 *   DynamicRoutes.set('/api/data', (req, res) => {
 *     res.writeHead(200, { 'Content-Type': 'application/json' });
 *     res.end(JSON.stringify({ status: 'ok' }));
 *   });
 */
export const DynamicRoutes = new Map<string, (req: http.IncomingMessage, res: http.ServerResponse) => void>();

/**
 * Start the test HTTP server on an ephemeral port.
 *
 * @param fixturesDir Directory containing fixture files (defaults to `./fixtures`).
 */
export function startTestServer(fixturesDir?: string): Promise<TestServer> {
  const root = fixturesDir ?? path.join(__dirname, 'fixtures');

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // CORS headers for cross-origin testing
      res.setHeader('Access-Control-Allow-Origin', '*');

      // Check dynamic routes first
      const urlPath = req.url ?? '/';
      const routeKey = urlPath.split('?')[0];
      const dynamicHandler = DynamicRoutes.get(routeKey);
      if (dynamicHandler) {
        dynamicHandler(req, res);
        return;
      }

      // Serve static files
      // Strip query string and normalise path
      let pathname = routeKey;
      if (pathname === '/') pathname = '/example.html';

      // Prevent path traversal
      const filePath = path.join(root, pathname);
      if (!filePath.startsWith(root)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end(`Not Found: ${pathname}`);
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME[ext] ?? 'application/octet-stream',
          'Cache-Control': 'no-cache',
        });
        res.end(data);
      });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve({
          baseUrl,
          url(file: string) {
            return `${baseUrl}/${file.replace(/^\//, '')}`;
          },
          close() {
            return new Promise<void>((r, j) => {
              // Force-close keep-alive connections (Node 18.2+). Browser
              // sessions — especially Safari — may leave idle keep-alive
              // sockets open after the WebDriver session ends; without this,
              // server.close() hangs until the sockets time out and hooks
              // (e.g. afterAll with a 10s budget) fail.
              if (typeof (server as any).closeAllConnections === 'function') {
                (server as any).closeAllConnections();
              }
              server.close((err) => (err ? j(err) : r()));
            });
          },
        });
      } else {
        reject(new Error('Failed to bind server'));
      }
    });
  });
}
