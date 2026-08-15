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
            className="bg-surface-inset flex items-center gap-3 rounded-[var(--radius-card)] p-4 sm:gap-4"
          >
            <span
              aria-hidden
              className="bg-surface-raised text-text-muted grid size-9 shrink-0 place-items-center rounded-[var(--radius-pill)] border border-[var(--border-hairline)] text-[0.8125rem] font-medium"
            >
              {r.handle.charAt(1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="num text-text truncate text-[0.9375rem]">{r.handle}</p>
              <p className="text-text-subtle mt-0.5 truncate text-xs">{r.memo}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="num text-text text-[0.9375rem]">
                <span className="text-text-subtle">{r.out ? '−' : '+'}</span>
                {r.amount}
              </p>
              <p className="num text-text-subtle mt-0.5 text-[0.6875rem]">MUSD</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="bg-surface-inset mt-6 flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--border-hairline)] py-2 pl-4 pr-2">
        <span className="num text-text-subtle flex-1 truncate text-sm">
          @handle · amount · memo
        </span>
        <span className="inline-flex h-9 shrink-0 items-center rounded-[var(--radius-pill)] bg-white px-4 text-[0.8125rem] font-medium text-[#08080A]">
          Send
        </span>
      </div>

      <p className="text-text-subtle mt-5 text-sm leading-relaxed">
        Handles resolve on-chain. Memos are indexed events. Payment links can be claimed by someone
        who has never touched Mezo and holds no BTC.
      </p>
    </div>
  );
}
