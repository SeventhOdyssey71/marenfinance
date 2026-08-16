import { ArrowRight } from '../ui/icons';

const steps = [
  {
    k: '01',
    title: 'You sign',
    body: 'An EIP-712 ForwardRequest. A signature, not a transaction, so it costs no gas.',
  },
  {
    k: '02',
    title: 'Maren relays',
    body: 'Our relayer verifies the signature, simulates the call, and pays the BTC gas.',
  },
  {
    k: '03',
    title: 'Mezo settles',
    body: 'ERC-2771 executes it as you. Funds move wallet to wallet under your own permit.',
  },
] as const;

/** F2 visual — where the gas actually comes from. */
export function GaslessFlow() {
  return (
    <div className="card overflow-hidden p-6 md:p-8">
      <p className="t-label text-text-subtle">Who pays the gas</p>

      <ol className="mt-7 space-y-3">
        {steps.map((s, i) => (
          <li key={s.k} className="relative">
            <div className="bg-surface-inset flex items-start gap-4 rounded-[var(--radius-card)] p-4 sm:p-5">
              <span className="num text-text-subtle mt-0.5 shrink-0 text-xs">{s.k}</span>
              <div className="min-w-0">
                <p className="text-text text-[0.9375rem] font-medium">{s.title}</p>
                <p className="text-text-muted mt-1.5 text-sm leading-relaxed">{s.body}</p>
              </div>
            </div>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className="text-text-subtle ml-[1.375rem] flex h-3 items-center sm:ml-[1.75rem]"
              >
                <svg viewBox="0 0 2 12" className="h-3 w-px" aria-hidden>
                  <path d="M1 0v12" stroke="currentColor" strokeWidth="1" strokeDasharray="2 3" />
                </svg>
              </span>
            )}
          </li>
        ))}
      </ol>

      <div className="bg-violet-500/6 mt-7 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-card)] border border-violet-500/20 px-5 py-4">
        <span className="num text-2xl font-medium text-violet-400">25</span>
        <span className="text-text-muted text-sm">
          free actions per address. After that, a small fee is taken in MUSD inside the same
          transaction, never in BTC.
        </span>
      </div>

      <p className="text-text-subtle mt-5 flex items-center gap-2 text-xs">
        <ArrowRight className="size-3.5 shrink-0" aria-hidden />
        The relayer never holds user funds. Compromising it costs us gas, not your Bitcoin.
      </p>
    </div>
  );
}
