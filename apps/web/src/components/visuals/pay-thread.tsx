const rows = [
  { handle: '@sele', memo: 'Dinner, split three ways', amount: '24.00', out: true },
  { handle: '@mira', memo: 'Invoice 0114', amount: '480.00', out: false },
  { handle: '@kofi', memo: 'Rent, August', amount: '650.00', out: true },
] as const;

/** F3 visual — what a payment surface for MUSD actually looks like. */
export function PayThread() {
  return (
    <div className="card overflow-hidden p-6 md:p-8">
      <p className="t-label text-text-subtle">Pay · example thread</p>

      <ul className="mt-7 space-y-2.5">
        {rows.map((r) => (
          <li
            key={r.handle}
            className="flex items-center gap-3 rounded-[var(--radius-card)] bg-surface-inset p-4 sm:gap-4"
          >
            <span
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-pill)] border border-[var(--border-hairline)] bg-surface-raised text-[0.8125rem] font-medium text-text-muted"
            >
              {r.handle.charAt(1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="num truncate text-[0.9375rem] text-text">{r.handle}</p>
              <p className="mt-0.5 truncate text-xs text-text-subtle">{r.memo}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="num text-[0.9375rem] text-text">
                <span className="text-text-subtle">{r.out ? '−' : '+'}</span>
                {r.amount}
              </p>
              <p className="num mt-0.5 text-[0.6875rem] text-musd">MUSD</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--border-hairline)] bg-surface-inset py-2 pr-2 pl-4">
        <span className="num flex-1 truncate text-sm text-text-subtle">
          @handle · amount · memo
        </span>
        <span className="inline-flex h-9 shrink-0 items-center rounded-[var(--radius-pill)] bg-white px-4 text-[0.8125rem] font-medium text-[#08080A]">
          Send
        </span>
      </div>

      <p className="mt-5 text-sm leading-relaxed text-text-subtle">
        Handles resolve on-chain. Memos are indexed events. Payment links can be claimed
        by someone who has never touched Mezo and holds no BTC.
      </p>
    </div>
  );
}
