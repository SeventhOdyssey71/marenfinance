import { LivePulseFrame } from '../shaders/live-pulse';

/**
 * F1 visual — the size of the door, drawn to scale, plus an illustrative
 * pooled position card. Every figure shown is labelled as an example; nothing
 * here is presented as live protocol data.
 */
export function CollateralFloor() {
  return (
    <div className="card overflow-hidden p-6 md:p-8">
      <p className="t-label text-text-subtle">Minimum to open · drawn to scale</p>

      <div className="mt-7 space-y-6">
        <div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-text-muted">Mezo trove minimum</span>
            <span className="num text-sm text-text">0.079 BTC</span>
          </div>
          <div className="mt-2.5 h-2.5 w-full overflow-hidden rounded-[var(--radius-pill)] bg-surface-inset">
            <div className="h-full w-full rounded-[var(--radius-pill)] bg-[linear-gradient(90deg,#3A3A44_0%,#55555F_100%)]" />
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-text-muted">Maren pooled floor</span>
            <span className="num text-sm text-violet-400">0.001 BTC</span>
          </div>
          <div className="mt-2.5 h-2.5 w-full overflow-hidden rounded-[var(--radius-pill)] bg-surface-inset">
            {/* 0.001 / 0.079 = 1.27% — floored to 6px so it stays visible */}
            <div className="h-full min-w-[6px] w-[1.27%] rounded-[var(--radius-pill)] bg-violet-500 shadow-[0_0_12px_rgba(91,61,245,0.7)]" />
          </div>
        </div>
      </div>

      <p className="mt-6 text-sm leading-relaxed text-text-subtle">
        The violet bar is 1.27% of the grey one. That gap is the entire addressable
        market Mezo is currently turning away.
      </p>

      <div className="mt-8 hairline-t pt-8">
        <LivePulseFrame>
          <div className="rounded-[var(--radius-card)] bg-surface-inset p-5">
            <div className="flex items-center justify-between gap-4">
              <p className="t-label text-text-subtle">Example position</p>
              <span className="inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-success/25 bg-success/8 px-2.5 py-1">
                <span aria-hidden className="size-1.5 rounded-full bg-success" />
                <span className="text-[0.6875rem] font-medium tracking-wide text-success">
                  Healthy
                </span>
              </span>
            </div>

            {/* Figures stay neutral. Three saturated colours in one small card reads
                as decoration, not information — the health chip above is the only
                thing here that carries a signal, so it is the only thing coloured. */}
            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-text-subtle">Collateral</dt>
                <dd className="num mt-1.5 text-[0.9375rem] text-text">0.004 BTC</dd>
              </div>
              <div>
                <dt className="text-xs text-text-subtle">Debt</dt>
                <dd className="num mt-1.5 text-[0.9375rem] text-text">100.00 MUSD</dd>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <dt className="text-xs text-text-subtle">Collateral ratio</dt>
                <dd className="num mt-1.5 text-[0.9375rem] text-text">252.0%</dd>
              </div>
            </dl>

            <p className="mt-5 text-xs leading-relaxed text-text-subtle">
              Illustrative figures. Maren liquidates internally at 140%, well above the
              protocol&rsquo;s 110% cliff.
            </p>
          </div>
        </LivePulseFrame>
      </div>
    </div>
  );
}
