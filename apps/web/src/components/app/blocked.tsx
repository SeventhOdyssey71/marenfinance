import type { Blocker, BlockerScope } from '@/lib/chain/preflight';

/**
 * The reason a control is disabled, stated where the control is.
 *
 * The rule this component encodes: a disabled control without a reason beside it is worse
 * than an enabled one that fails, because at least the failure eventually explains itself.
 * So every `Preflight` blocker renders here, adjacent to the button it disabled, before
 * anything is attempted — and it renders the SAME sentence the revert would have carried,
 * because `preflight.ts` builds its blockers from `describeRevert()`.
 *
 * TONE CARRIES ONE BIT AND NO MORE. BRAND.md §2: the only saturated colour on a default
 * screen is the violet CTA, and health colours appear only when they carry meaning. The
 * distinction worth a colour here is whether the user can do anything about it:
 *
 *   `pool` / `feed`  — amber. Not your fault, not your fix. The pooled trove is under its
 *                      floor; the oracle is stale. Waiting is the action.
 *   everything else  — hairline. You typed too large a number, or your wallet is empty.
 *                      A neutral well, because there is nothing alarming about it.
 *
 * `role` is left to the caller. A reason that is present on first paint is not an alert —
 * announcing "the pool is fully drawn" the instant a screen reader lands on the Vault
 * would be an interruption, not information — so the default is `status`, and only a
 * reason that appears in response to something the user just typed gets `alert`.
 */

const external: readonly BlockerScope[] = ['pool', 'feed'];

export function BlockedNote({
  blocker,
  id,
  role = 'status',
  className = '',
}: {
  blocker: Blocker;
  /** Point the control's `aria-describedby` at this, so the reason is read with it. */
  id?: string;
  role?: 'status' | 'alert';
  className?: string;
}) {
  const amber = external.includes(blocker.scope);

  return (
    <div
      id={id}
      role={role}
      className={`bg-surface-inset rounded-[var(--radius-input)] border p-4 ${
        amber ? 'border-warning/30' : 'border-[var(--border-hairline)]'
      } ${className}`}
    >
      <p className={`text-sm font-medium ${amber ? 'text-warning' : 'text-text'}`}>
        {blocker.title}
      </p>
      <p
        data-contrast="blocked-detail"
        className="text-text-muted mt-1.5 max-w-[68ch] text-sm leading-relaxed"
      >
        {blocker.detail}
      </p>
      {/* The Solidity name, small, for anyone who wants to grep the source. Kept secondary
          — BRAND.md keeps contract internals off the primary surface — but kept, because
          deleting it makes the sentence above unfalsifiable. */}
      {blocker.name ? (
        <p className="mono text-text-muted mt-2.5 text-xs">Contract check: {blocker.name}</p>
      ) : null}
    </div>
  );
}
