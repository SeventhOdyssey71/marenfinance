import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// @ts-expect-error - plain ESM helper shared with apps/ios, no types needed
import { findEmDashes } from '../../../../tools/copy/em-dash-scan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const webSrc = resolve(here, '..');

/**
 * No em dash reaches a user of the web app.
 *
 * The rewrite that removed them was per sentence, not a find-and-replace, so this guard
 * is about stopping the character coming back rather than about how any one sentence
 * ended up worded. Comments are exempt; so is the lone `—` placeholder, which is the
 * "no value" glyph from @maren/sdk and not prose. See tools/copy/em-dash-scan.mjs.
 */
describe('web copy contains no em dashes', () => {
  it('has none in any user-visible string', () => {
    const hits = findEmDashes([webSrc]) as { file: string; line: number; text: string }[];
    const report = hits.map((h) => `${h.file}:${h.line}\n    ${h.text}`).join('\n');
    expect(report).toBe('');
  });
});
