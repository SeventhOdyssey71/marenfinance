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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

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
    // Test files are not user copy. A `describe('borrow — ...')` string is read by
    // whoever runs the suite, never by anyone using the app, and letting the guard
    // police them turns a copy rule into a naming rule.
    else if (/\.(test|spec)\.[jt]sx?$/.test(entry)) continue;
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

/**
 * Every tree that holds user-visible copy, together.
 *
 * The two vitest suites each scan only their own app, because a failure there should
 * name the app it belongs to. This list is the union, and it is what the command line
 * scans. A new app has to be added here or the command-line gate silently stops covering
 * it, which is the failure the existence check below exists to make impossible.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const COPY_ROOTS = [
  join(REPO_ROOT, 'apps', 'web', 'src'),
  // The iOS app is now native Swift (apps/ios-native) — this scanner only reads
  // .ts/.tsx/.js/.jsx/.css, so it cannot cover Swift copy; the old Expo roots
  // (apps/ios/app, apps/ios/src) are gone. Web is the only JS/TS copy surface.
];

/**
 * Running this file directly scans every copy root and exits non-zero on a hit, so the
 * rule is enforceable from a shell and from CI without a package install. Importing it
 * does nothing, which is what the vitest suites rely on.
 */
if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  // A root that has moved or been renamed would otherwise scan zero files and report a
  // clean run. An empty scan is the one result this gate must never confuse with a pass.
  const missing = COPY_ROOTS.filter((root) => !existsSync(root));
  if (missing.length > 0) {
    console.error('These copy roots do not exist, so nothing was scanned in them:');
    for (const root of missing) console.error(`  ${relative(REPO_ROOT, root)}`);
    console.error('\nFix the list in tools/copy/em-dash-scan.mjs.');
    exit(1);
  }

  const hits = findEmDashes(COPY_ROOTS);
  if (hits.length > 0) {
    for (const hit of hits) {
      console.error(`${relative(REPO_ROOT, hit.file)}:${hit.line}\n    ${hit.text}`);
    }
    console.error(
      `\n${hits.length} em dash(es) in user-visible copy. Rewrite the sentence; do not just delete the glyph.`,
    );
    exit(1);
  }
  console.log(`No em dashes in user-visible copy (${COPY_ROOTS.length} trees scanned).`);
}
