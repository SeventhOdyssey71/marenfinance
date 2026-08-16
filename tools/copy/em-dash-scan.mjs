/**
 * Finds em dashes in user-visible copy.
 *
 * Maren's product copy does not use em dashes. The rule is about the writing, not the
 * character: a dash is almost always doing grammatical work that a comma, a colon or a
 * full stop does better, and "rewrite the sentence" is the fix rather than "delete the
 * glyph". This scanner exists so a dash cannot come back in unnoticed.
 *
 * Two things are deliberately NOT violations:
 *
 *   1. Code comments. They are for the people editing the file, not for users.
 *   2. The lone placeholder, `—` as an entire string. `EM_DASH` in @maren/sdk is the
 *      standard glyph for "this figure does not exist" (no debt, so no liquidation
 *      price). A hyphen there reads as a typo and an empty cell reads as a loading
 *      state, so the placeholder stays. `formatLiquidationPrice` and friends return it,
 *      and `money.tsx` branches its tone on it.
 *
 * Comment detection is line-based and intentionally strict: a trailing comment sharing a
 * line with code (`const x = 1; // note —`) is reported. That is a false positive, and
 * the fix is to move the note to its own line, which this codebase does anyway.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const EM_DASH = '—';
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.css'];

/**
 * The glyph standing entirely alone, which is the "no value" placeholder rather than
 * prose. Alone means: quoted with nothing else inside (`'—'`), or a JSX text node with
 * nothing else inside (`>—<`). A dash with words either side is prose, which is the
 * whole point, so the patterns below are deliberately narrow.
 */
const PLACEHOLDERS = [
  new RegExp(`'${EM_DASH}'`, 'g'),
  new RegExp(`"${EM_DASH}"`, 'g'),
  new RegExp(`\`${EM_DASH}\``, 'g'),
  new RegExp(`>${EM_DASH}<`, 'g'),
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.expo') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (EXTENSIONS.some((e) => entry.endsWith(e))) out.push(path);
  }
  return out;
}

/**
 * @param {string[]} roots directories to scan
 * @returns {{file: string, line: number, text: string}[]} prose occurrences
 */
export function findEmDashes(roots) {
  const hits = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      let inBlockComment = false;
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        const startedInComment = inBlockComment;
        if (trimmed.includes('/*')) inBlockComment = true;
        if (trimmed.includes('*/')) inBlockComment = false;
        if (!line.includes(EM_DASH)) return;

        const isComment =
          startedInComment ||
          trimmed.startsWith('//') ||
          trimmed.startsWith('*') ||
          trimmed.startsWith('/*') ||
          trimmed.startsWith('{/*');
        if (isComment) return;

        // A JSX child sitting alone on its own line is the placeholder too.
        if (trimmed === EM_DASH) return;

        // Strip every standalone placeholder, then see if any dash survives.
        let rest = line;
        for (const pattern of PLACEHOLDERS) rest = rest.replace(pattern, '');
        if (!rest.includes(EM_DASH)) return;

        hits.push({ file, line: index + 1, text: trimmed });
      });
    }
  }
  return hits;
}

export { EM_DASH };
