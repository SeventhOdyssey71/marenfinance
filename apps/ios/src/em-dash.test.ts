import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { findEmDashes } from '../../../tools/copy/em-dash-scan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const iosRoot = resolve(here, '..');

/**
 * No em dash reaches a user of the iOS app. The web app asserts the same thing over its
 * own tree, through the same scanner, so the two cannot drift. See the note in
 * tools/copy/em-dash-scan.mjs for what is exempt and why.
 */
describe('iOS copy contains no em dashes', () => {
  it('has none in any user-visible string', () => {
    const hits = findEmDashes([resolve(iosRoot, 'app'), resolve(iosRoot, 'src')]) as {
      file: string;
      line: number;
      text: string;
    }[];
    const report = hits.map((h) => `${h.file}:${h.line}\n    ${h.text}`).join('\n');
    expect(report).toBe('');
  });
});
