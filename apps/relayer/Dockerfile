# syntax=docker/dockerfile:1
#
# Maren relayer: production image.
#
# Build from the REPO ROOT, not from this directory, because the relayer is a
# pnpm workspace package and needs the root lockfile:
#
#   docker build -f apps/relayer/Dockerfile -t maren-relayer .
#
# Three things this image is deliberate about:
#
#   1. Only the workspace manifests are copied before `pnpm install`, so the
#      dependency layer is cached until a package.json or the lockfile changes.
#   2. `--prod`: no vitest, no typescript, no tsx-the-devtool. NOTE that `tsx`
#      itself IS a production dependency of this package: `pnpm start` runs
#      `node --import tsx src/server.ts`, and @maren/sdk ships TypeScript source,
#      so the runtime loads TS. That is a deliberate trade (one dependency in the
#      image) against maintaining a second build output for the SDK.
#   3. A non-root user owns nothing it does not need to. The relayer writes no
#      files; it reads a keystore and a passphrase file that are mounted in.

# --- deps -------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# Manifests only. Adding a source file must not invalidate the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/relayer/package.json ./apps/relayer/
COPY packages/sdk/package.json ./packages/sdk/

# `--frozen-lockfile` so an image can never be built against a resolution the
# lockfile does not describe. `--filter @maren/relayer...` pulls in @maren/sdk
# (the trailing "..." is its dependencies) and nothing else in the workspace.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts --filter @maren/relayer...

# --- runtime ----------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# node:22-bookworm-slim already ships an unprivileged `node` user (uid 1000).
# Using it rather than minting another keeps file ownership predictable when an
# operator bind-mounts a keystore: `chown 1000:1000` is the whole story.
COPY --chown=node:node package.json pnpm-workspace.yaml ./
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node --from=deps /app/apps/relayer/node_modules ./apps/relayer/node_modules
COPY --chown=node:node --from=deps /app/packages/sdk/node_modules ./packages/sdk/node_modules
COPY --chown=node:node packages/sdk/package.json ./packages/sdk/
COPY --chown=node:node packages/sdk/src ./packages/sdk/src
COPY --chown=node:node apps/relayer/package.json apps/relayer/tsconfig.json ./apps/relayer/
COPY --chown=node:node apps/relayer/src ./apps/relayer/src

USER node
WORKDIR /app/apps/relayer

# `PORT` is what src/config.ts reads; 8787 is its default.
ENV PORT=8787
EXPOSE 8787

# /healthz makes no RPC calls, so a degraded public Mezo endpoint does not
# restart-loop a relayer that is otherwise fine. It answers 503 while the
# relayer is refusing to relay, which is the state a fresh deploy starts in.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `node --import tsx`, NOT the `tsx` CLI: the CLI wrapper runs the program as a
# child process and does not forward SIGTERM, so the drain handler in
# src/server.ts would never run and every deploy would kill in-flight
# submissions between "nonce allocated" and "broadcast returned". Verified
# against tsx 4.23.12. Keep this in step with the `start` script.
CMD ["node", "--import", "tsx", "src/server.ts"]
