/**
 * Copy the monorepo's `docs-site/` tree into the web app as `docs-content/` before
 * every build/dev.
 *
 * The /docs route reads MDX + docs.json from disk. On Vercel the serverless function
 * only ships files inside the app's project dir, so a read of `../../docs-site`
 * (outside apps/web) is absent at runtime and the route 500s. Mirroring the tree
 * into `apps/web/docs-content` (gitignored) makes it an in-project path that Next's
 * `outputFileTracingIncludes` can bundle reliably. Content stays single-sourced in
 * `docs-site/`; this copy is a build artefact, never edited by hand or committed.
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(appDir, '..', '..', 'docs-site');
const dest = join(appDir, 'docs-content');

if (!existsSync(join(src, 'docs.json'))) {
  console.error(`[sync-docs] source docs-site not found at ${src}`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, {
  recursive: true,
  filter: (p) => !p.includes('node_modules') && !p.includes('/.'),
});
console.log(`[sync-docs] mirrored docs-site -> ${dest}`);
