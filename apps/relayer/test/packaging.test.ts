import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The deployment artifacts, checked against the code they claim to run.
 *
 * A Dockerfile is the one file in a repository that nothing else references, so
 * it drifts silently: the start command changes, a workspace package is renamed,
 * a dependency moves from `dependencies` to `devDependencies`, and the image
 * keeps building until the day someone deploys it. These are the couplings that
 * a reader would otherwise have to hold in their head.
 *
 * What this file does NOT claim: that the image builds. No Docker daemon was
 * available when it was written, and DEPLOY.md says so rather than implying a
 * build that never happened.
 */

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const relayerDir = fileURLToPath(new URL('..', import.meta.url));

async function read(path: string): Promise<string> {
  return readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('Dockerfile', () => {
  it('is multi-stage and installs production dependencies only', async () => {
    const dockerfile = await read('../Dockerfile');
    // Two build stages: one that resolves dependencies, one that ships.
    expect(dockerfile.match(/^FROM /gm)?.length).toBeGreaterThanOrEqual(2);
    expect(dockerfile).toMatch(/pnpm install[^\n]*--prod/);
    // A build that can drift from the lockfile is a build that can ship a
    // resolution nobody reviewed.
    expect(dockerfile).toMatch(/pnpm install[^\n]*--frozen-lockfile/);
    // Workspace-aware: the relayer plus its workspace dependencies, nothing else.
    expect(dockerfile).toMatch(/--filter @maren\/relayer\.\.\./);
  });

  it('runs as a non-root user', async () => {
    const dockerfile = await read('../Dockerfile');
    expect(dockerfile).toMatch(/^USER node$/m);
    // And the USER instruction must come before the process starts, or it does
    // nothing at all.
    expect(dockerfile.indexOf('USER node')).toBeLessThan(dockerfile.indexOf('CMD'));
  });

  it('starts the server the same way `pnpm start` does', async () => {
    const dockerfile = await read('../Dockerfile');
    const pkg = JSON.parse(await read('../package.json')) as { scripts: Record<string, string> };
    // `node --import tsx`, never the tsx CLI: the CLI wrapper runs the program
    // as a child process and does not forward SIGTERM, so the drain handler
    // would never run and every deploy would strand a nonce.
    expect(pkg.scripts['start']).toBe('node --import tsx src/server.ts');
    expect(dockerfile).toMatch(/CMD \["node", "--import", "tsx", "src\/server\.ts"\]/);
  });

  it('keeps tsx a production dependency, because the image installs --prod', async () => {
    // The runtime loads TypeScript directly (@maren/sdk ships source), so tsx is
    // not a development tool here. Moving it back to devDependencies would build
    // an image that cannot start.
    const pkg = JSON.parse(await read('../package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.dependencies['tsx']).toBeDefined();
    expect(pkg.devDependencies['tsx']).toBeUndefined();
  });

  it('copies only paths that exist in the repository', async () => {
    const dockerfile = await read('../Dockerfile');
    const sources = dockerfile
      .split('\n')
      .filter((line) => line.startsWith('COPY ') && !line.includes('--from='))
      .flatMap((line) => line.slice('COPY '.length).trim().split(/\s+/).slice(0, -1))
      .filter((source) => !source.startsWith('--'));
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(
        await exists(`${repoRoot}/${source}`),
        `Dockerfile copies ${source}, which does not exist`,
      ).toBe(true);
    }
  });

  it('health-checks /healthz, which is a route this service actually serves', async () => {
    const dockerfile = await read('../Dockerfile');
    const app = await read('../src/app.ts');
    expect(dockerfile).toMatch(/HEALTHCHECK/);
    expect(dockerfile).toContain('/healthz');
    expect(app).toMatch(/app\.get\('\/healthz'/);
  });

  it('has a .dockerignore at the build context root that excludes node_modules', async () => {
    // The build context is the repo root, so a .dockerignore beside the
    // Dockerfile would never be read. That is the usual way this goes wrong.
    const ignore = await readFile(`${repoRoot}/.dockerignore`, 'utf8');
    expect(ignore).toMatch(/^node_modules$/m);
    expect(ignore).toMatch(/^\.git$/m);
  });
});

describe('docker-compose.yml', () => {
  it('builds from the repo root with the relayer Dockerfile', async () => {
    const compose = await read('../docker-compose.yml');
    expect(compose).toMatch(/context: \.\.\/\.\./);
    expect(compose).toMatch(/dockerfile: apps\/relayer\/Dockerfile/);
    expect(await exists(`${relayerDir}/Dockerfile`)).toBe(true);
  });

  it('pins a single replica, because the nonce queue is in-process', async () => {
    const compose = await read('../docker-compose.yml');
    expect(compose).toMatch(/replicas: 1/);
  });

  it('allows longer to stop than the relayer takes to drain', async () => {
    // A SIGKILL between "nonce allocated" and "broadcast returned" leaves a
    // nonce gap that stalls every later transaction.
    const compose = await read('../docker-compose.yml');
    const config = await read('../src/config.ts');
    const grace = Number(/stop_grace_period: (\d+)s/.exec(compose)?.[1]);
    const drainMs = Number(
      /RELAYER_SHUTDOWN_DRAIN_MS', ([\d_]+)/.exec(config)?.[1]?.replace(/_/g, ''),
    );
    expect(grace * 1000).toBeGreaterThan(drainMs);
  });

  it('reads its environment from a file the repository never commits', async () => {
    const compose = await read('../docker-compose.yml');
    expect(compose).toMatch(/\.env\.relayer/);
    const gitignore = await readFile(`${repoRoot}/.gitignore`, 'utf8');
    expect(gitignore).toMatch(/^\.env\.\*$/m);
    // The template beside it carries no secrets and must survive that rule.
    expect(gitignore).toMatch(/^!\.env\.relayer\.example$/m);
    expect(await exists(`${relayerDir}/.env.relayer.example`)).toBe(true);
  });

  it('does not publish the relayer straight onto a public interface', async () => {
    const compose = await read('../docker-compose.yml');
    expect(compose).toMatch(/'127\.0\.0\.1:8787:8787'/);
  });
});

describe('fly.toml', () => {
  it('runs exactly one machine and never stops it', async () => {
    const fly = await read('../fly.toml');
    // Both are correctness constraints, not cost settings: two machines share a
    // nonce, and a stopped machine has no stuck-transaction sweeper.
    expect(fly).toMatch(/auto_stop_machines = false/);
    expect(fly).toMatch(/min_machines_running = 1/);
    expect(fly).not.toMatch(/strategy = "(bluegreen|canary)"/);
  });

  it('points at the Dockerfile from a repo-root build context', async () => {
    const fly = await read('../fly.toml');
    expect(fly).toMatch(/dockerfile = "apps\/relayer\/Dockerfile"/);
  });

  it('checks /healthz and allows longer than the drain to shut down', async () => {
    const fly = await read('../fly.toml');
    const config = await read('../src/config.ts');
    expect(fly).toMatch(/path = "\/healthz"/);
    const killTimeout = Number(/kill_timeout = "(\d+)s"/.exec(fly)?.[1]);
    const drainMs = Number(
      /RELAYER_SHUTDOWN_DRAIN_MS', ([\d_]+)/.exec(config)?.[1]?.replace(/_/g, ''),
    );
    expect(killTimeout * 1000).toBeGreaterThan(drainMs);
  });

  it('keeps the key on a volume rather than in the environment', async () => {
    const fly = await read('../fly.toml');
    expect(fly).toMatch(/RELAYER_KEYSTORE_PATH/);
    expect(fly).toMatch(/RELAYER_KEYSTORE_PASSWORD_FILE/);
    expect(fly).not.toMatch(/RELAYER_PRIVATE_KEY *=/);
    expect(fly).toMatch(/\[mounts\]/);
  });
});

describe('DEPLOY.md', () => {
  it('says plainly that nothing is deployed yet', async () => {
    // R13. The moment this stops being true, the owner edits one section; until
    // then a document that implies a running service is a false claim.
    const deploy = await read('../DEPLOY.md');
    expect(deploy).toMatch(/relayer is not running anywhere/i);
  });

  it('does not claim the image was built or deployed', async () => {
    const deploy = await read('../DEPLOY.md');
    expect(deploy).toMatch(/The Docker image builds\s*\|\s*\*\*No\.\*\*/);
    expect(deploy).toMatch(/The Fly\.io deployment works\s*\|\s*\*\*No\.\*\*/);
  });

  it('keeps the testnet-on-standalone boundary explicit and mainnet gated', async () => {
    const deploy = await read('../DEPLOY.md');
    expect(deploy).toMatch(/standalone server is the only\s*\n?supported target/);
    expect(deploy).toMatch(/## Mainnet gates/);
    expect(deploy).toMatch(/KMS or HSM signer\. Not implemented/);
  });

  it('is reachable from the README, or nobody will find it', async () => {
    const readme = await read('../README.md');
    expect(readme).toContain('DEPLOY.md');
  });
});
