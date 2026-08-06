import { Response } from '../../response';
import { safeFilename } from './shared';
import * as fs from 'fs';
import * as path from 'path';

/**
 * v0.10: `pdf` — save the current page as a PDF.
 *
 * Uses the W3C WebDriver print endpoint (`driver.printPage()`), which
 * returns a base64-encoded PDF and works on Chromium (Chrome/Edge) and
 * Firefox. Output lands in `<cwd>/.se-cli/` like screenshots.
 */
export async function browser_pdf(
  driver: any,
  params: { filename?: string },
  response: Response
): Promise<void> {
  const data = await driver.printPage();
  const outDir = path.join(process.cwd(), '.se-cli');
  fs.mkdirSync(outDir, { recursive: true });
  const filename = params.filename ? safeFilename(params.filename) : `page-${Date.now()}.pdf`;
  const file = path.join(outDir, filename);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));

  response.addCode(`const pdf = await driver.printPage(); fs.writeFileSync('${filename}', Buffer.from(pdf, 'base64'));`);
  response.addResult(`[PDF](.se-cli/${filename})`);
}
