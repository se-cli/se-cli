import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Response } from '../../src/response';
import { browser_pdf } from '../../src/daemon/tools/pdf';

describe('browser_pdf', () => {
  let tmpCwd: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-pdf-'));
    process.chdir(tmpCwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  function mockDriver(printResult = 'JVBERi0xLjQ='): any {
    // 'JVBERi0xLjQ=' base64-decodes to '%PDF-1.4'
    return {
      printPage: vi.fn(async () => printResult),
    };
  }

  it('calls printPage, writes a PDF file, adds a result', async () => {
    const driver = mockDriver();
    const response = new Response({ raw: false, json: false });

    await browser_pdf(driver, { filename: 'doc.pdf' }, response);

    expect(driver.printPage).toHaveBeenCalled();
    const file = path.join(tmpCwd, '.se-cli', 'doc.pdf');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('%PDF-1.4');
    const out = response.serialize();
    expect(out).toContain('[PDF](.se-cli/doc.pdf)');
  });

  it('defaults the filename to page-<timestamp>.pdf when not provided', async () => {
    const driver = mockDriver();
    const response = new Response({ raw: false, json: false });

    await browser_pdf(driver, {}, response);

    const entries = fs.readdirSync(path.join(tmpCwd, '.se-cli'));
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatch(/^page-\d+\.pdf$/);
  });

  it('rejects filenames with path separators (traversal attempt)', async () => {
    const driver = mockDriver();
    const response = new Response({ raw: false, json: false });

    await expect(browser_pdf(driver, { filename: '../../evil.pdf' }, response))
      .rejects.toThrow(/path separators/i);
  });

  it('emits replay code using driver.printPage', async () => {
    const driver = mockDriver();
    const response = new Response({ raw: false, json: false });

    await browser_pdf(driver, { filename: 'r.pdf' }, response);

    const out = response.serialize();
    expect(out).toContain('driver.printPage()');
  });
});
