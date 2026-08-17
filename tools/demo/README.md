# `@maren/demo` — the walkthrough recorder

Produces `docs/demo/maren-walkthrough.webm` (and an `.mp4` beside it) by driving the real
app in a real browser and filming the result. It is a build step, not a screen capture:
same command, same video.

```sh
CI=true pnpm install
CI=true pnpm --filter @maren/web build
pnpm --filter @maren/demo browsers          # once: the pinned Chromium + ffmpeg
MAREN_TEST_PRIVATE_KEY=0x… node tools/demo/record.mjs
```

## Why a script instead of a recording

A hand-made demo video is accurate until somebody touches the UI, and re-making it costs an
afternoon and a steady hand. This costs two minutes of unattended terminal, so the video can
be regenerated the morning it is shown rather than being a six-week-old artefact everyone
quietly knows is out of date.

## What is real

Everything. Every figure in the recording is read from Mezo matsnet over JSON RPC while the
camera is rolling: the oracle price, the pooled trove's collateral ratio, balances, history.
Nothing is seeded, stubbed, or mocked, and no scene is skipped for being unflattering.

The wallet is a genuine EIP-1193 provider built on a real private key, reusing
`apps/web/scripts/injected-wallet.mjs` so the video cannot drift from what the behaviour
checks exercise. The key stays in Node behind a Playwright binding; the page only ever sees
the interface MetaMask would present.

**The walkthrough submits no transaction.** It fills the Pay form and stops. A take costs
zero gas and can be run as often as needed.

## Layout

| File              | Responsibility                                                 |
| ----------------- | -------------------------------------------------------------- |
| `record.mjs`      | Orchestration, CLI flags, the run report                       |
| `lib/server.mjs`  | Boots `next start` from the production build on a free port    |
| `lib/browser.mjs` | Chromium resolution and the WebGL launch flags                 |
| `lib/cursor.mjs`  | The on-screen pointer, and hand-paced mouse travel             |
| `lib/pacing.mjs`  | Beat durations, eased scrolling, "do not film a loading state" |
| `lib/scenes.mjs`  | **The walkthrough itself. This is the file that goes stale.**  |
| `lib/encode.mjs`  | Finalising the WebM, the optional MP4, contact-sheet stills    |

Everything except `scenes.mjs` is about producing a video at all. `scenes.mjs` is coupled to
the current markup — heading text, tab labels, the copy inside a disabled control — and is
what needs editing when the UI changes.

## WebGL is not optional

Maren's hero, its closing band, and the ring on the position-health card are
`@paper-design/shaders-react` canvases, which are WebGL. A Chromium launched with
`--disable-gpu` (the reflex flag for headless automation) creates no WebGL context, the
shaders fall back to a flat gradient, and the recording shows a page that looks broken in a
way nobody can diagnose from the video.

So: `--use-gl=angle --enable-unsafe-swiftshader`, never `--disable-gpu`. `record.mjs` proves
a WebGL context exists before it spends two minutes filming, and fails loudly if it does not.

## Pacing

Every duration in `lib/pacing.mjs` is longer than correctness requires. The constraint is not
"did the click land", it is "could a person following along have read the screen before it
changed". Scenes reference the shared `BEATS` rather than inventing their own, so the whole
video keeps one rhythm. If the take drifts outside 90 to 120 seconds, adjust `BEATS` — not
the narration in `docs/demo/SCRIPT.md`.

## Environment

| Variable                 | Effect                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAREN_TEST_PRIVATE_KEY` | The signer injected into the page. **Never commit this.** Without it the app is filmed disconnected, which is a real screen but a thinner demo. |
| `MEZO_RPC_URL`           | Defaults to `https://rpc.test.mezo.org`                                                                                                         |
| `MAREN_DEMO_HANDLE`      | Handle typed into Pay (default `@sele`)                                                                                                         |
| `DEMO_BASE_URL`          | Record against a server already running, skipping the boot                                                                                      |
| `CHROME_EXECUTABLE`      | Use a specific Chromium instead of the managed build                                                                                            |

## Flags

```sh
node tools/demo/record.mjs --only vault,pay    # re-shoot a subset while iterating
node tools/demo/record.mjs --out /tmp/take.webm
node tools/demo/record.mjs --frames 20         # contact-sheet stills (default 14)
node tools/demo/record.mjs --no-frames
```

## Checking a take

The run prints every value the camera saw, with the timestamp it was on screen. That log is
the record of the take: which figures were live, which screens were empty. Stills land in
`docs/demo/frames/` so a take can be checked without scrubbing.

The video itself is gitignored (see `docs/demo/.gitignore`). Recording is cheap and the app
changes often, so the repo keeps the recorder and the narration rather than a binary that is
wrong within a sprint.
