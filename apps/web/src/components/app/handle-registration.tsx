'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient } from 'wagmi';
import type { Hex } from 'viem';

import { ActionButton, AppCard, CardTitle, Info, Note } from '@/components/app/primitives';
import { ArrowRight } from '@/components/ui/icons';
import { useTxRunner, type TxRunner } from '@/components/app/tx';
import {
  clearCommitment,
  computeCommitment,
  loadCommitment,
  newSecret,
  readCommittedAt,
  saveCommitment,
  validateHandle,
  type PendingCommitment,
} from '@/lib/chain/handle';
import { gasNote, useMarenWrites } from '@/lib/chain/write';
import { NETWORK, useDataSource, useHandleAvailable, usePrimaryHandle } from '@/lib/data/source';

/**
 * Claim an `@handle` — MarenRegistry's commit-reveal, as two visible steps.
 *
 * The 60 seconds between them is not a loading spinner and is not apologised for: it is
 * the mechanism that stops someone in the mempool taking the name, and the screen says so
 * while it counts down. A user who understands why they are waiting does not refresh; a
 * user who thinks it is broken does, which is exactly when a secret held in React state
 * would be lost. It is not held in React state — see `lib/chain/handle.ts`.
 *
 * THE COUNTDOWN IS CHAIN TIME, NOT BROWSER TIME. `commitments(commitment)` returns the
 * block timestamp the contract recorded, and the remaining wait is measured against the
 * latest block's timestamp. A countdown run off `Date.now()` on a machine whose clock is
 * thirty seconds fast tells the user to reveal, and the reveal reverts with
 * `CommitmentTooNew` — a self-inflicted failure that looks like a product bug.
 */
export function HandleRegistration({ runner }: { runner: TxRunner }) {
  const source = useDataSource();
  const { address } = useAccount();
  const client = usePublicClient();
  const writes = useMarenWrites();
  const queryClient = useQueryClient();
  const { data: primary } = usePrimaryHandle();

  const [input, setInput] = useState('');
  const handle = input.trim().replace(/^@/, '').toLowerCase();
  const validation = validateHandle(input);

  const { data: available, isFetching: checkingAvailable } = useHandleAvailable(handle);

  const [pending, setPending] = useState<PendingCommitment | null>(null);
  const [committedAt, setCommittedAt] = useState<bigint | null>(null);
  const [chainNow, setChainNow] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Re-attach to a commitment this browser already holds a secret for. This is what makes
  // a refresh mid-wait survivable, and it runs on every handle keystroke so typing the
  // same name again picks the flow back up rather than starting a second one.
  useEffect(() => {
    if (handle.length < 3) {
      setPending(null);
      return;
    }
    setPending(loadCommitment(NETWORK, handle));
  }, [handle]);

  /**
   * Poll the contract for the commitment's age.
   *
   * Both values come from the chain: `committedAt` from the registry's own mapping, and
   * `now` from the latest block. Polling stops as soon as the wait is over.
   */
  useEffect(() => {
    if (!pending || !client) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const [at, block] = await Promise.all([
          readCommittedAt(client, NETWORK, pending.commitment),
          client.getBlock({ blockTag: 'latest' }),
        ]);
        if (cancelled) return;
        setCommittedAt(at);
        setChainNow(block.timestamp);
      } catch {
        // A failed poll leaves the previous values in place. It must not reset the
        // countdown to "unknown" and make a nearly-ready commitment look unstarted.
      }
    };

    void tick();
    const id = setInterval(() => void tick(), 2_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pending, client]);

  const secondsRemaining = useMemo(() => {
    if (committedAt === null || committedAt === 0n || chainNow === null) return null;
    const ready = committedAt + 60n;
    return chainNow >= ready ? 0 : Number(ready - chainNow);
  }, [committedAt, chainNow]);

  const onChain = committedAt !== null && committedAt > 0n;
  const revealable = onChain && secondsRemaining === 0;

  /**
   * Step one. The secret is generated and STORED BEFORE the wallet is opened, so a user
   * who signs and immediately reloads still has it.
   */
  const beginCommit = useCallback(async () => {
    if (!client || !address) return;
    setProblem(null);
    setBusy(true);
    try {
      const secret: Hex = newSecret();
      const commitment = await computeCommitment(client, NETWORK, handle, address, secret);
      const record: PendingCommitment = {
        handle,
        secret,
        owner: address,
        commitment,
        network: NETWORK,
      };
      saveCommitment(record);
      setPending(record);

      runner.request({
        title: `Commit to @${handle}`,
        details: [
          { label: 'Handle', value: <span className="text-text">@{handle}</span> },
          {
            label: 'Commitment',
            value: <span className="num text-text-subtle break-all text-xs">{commitment}</span>,
          },
          {
            label: 'Owner',
            value: <span className="num text-text-subtle break-all text-xs">{address}</span>,
          },
        ],
        gas: gasNote(
          true,
          'Publishes a hash, not the name. Nobody watching this transaction can tell which handle you are claiming.',
        ),
        caution:
          'The secret for this commitment is stored in this browser only. Claim the handle from this device, or you will have to wait seven days for the commitment to expire.',
        confirmLabel: 'Commit',
        submit: writes.ready
          ? async () => {
              const hash = await writes.commitHandle(commitment);
              saveCommitment({ ...record, txHash: hash });
              return hash;
            }
          : undefined,
      });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [address, client, handle, runner, writes]);

  /** Step two. Reveals the secret; the contract re-derives the commitment and matches it. */
  const beginRegister = useCallback(() => {
    if (!pending) return;
    runner.request({
      title: `Claim @${pending.handle}`,
      details: [
        { label: 'Handle', value: <span className="text-text">@{pending.handle}</span> },
        {
          label: 'Committed at',
          value: (
            <span className="num text-text-subtle text-xs">
              block timestamp {committedAt?.toString() ?? '—'}
            </span>
          ),
        },
        {
          label: 'Owner',
          value: <span className="num text-text-subtle break-all text-xs">{pending.owner}</span>,
        },
      ],
      gas: gasNote(true, 'Reveals the secret and writes the handle to MarenRegistry.'),
      confirmLabel: 'Claim handle',
      submit: writes.ready
        ? async () => {
            const hash = await writes.registerHandle(pending.handle, pending.secret);
            return hash;
          }
        : undefined,
    });
  }, [committedAt, pending, runner, writes]);

  /**
   * Once the handle resolves to this account the secret is worthless, so it is deleted.
   * Keyed off the resolved handle rather than off "the transaction succeeded", because the
   * chain is the authority on whether the name is actually ours.
   */
  useEffect(() => {
    if (!pending || !primary) return;
    if (primary.toLowerCase() === `@${pending.handle}`) {
      clearCommitment(NETWORK, pending.handle);
      setPending(null);
      setCommittedAt(null);
      void queryClient.invalidateQueries({ queryKey: ['maren'] });
    }
  }, [pending, primary, queryClient]);

  if (!source.connected) return null;

  const taken = available === false;

  return (
    <AppCard className="p-6 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <CardTitle>Your handle</CardTitle>
        {primary ? <span className="t-label text-text-subtle">{primary}</span> : null}
      </div>

      <p className="text-text-muted mt-3 max-w-[68ch] text-sm leading-relaxed">
        {primary
          ? `You hold ${primary}. Claim another below if you want a second one.`
          : 'A handle is how people pay you without pasting an address. Claiming one takes two transactions, 60 seconds apart.'}
      </p>

      <div className="mt-8 max-w-md">
        <label htmlFor="handle-input" className="t-label text-text-subtle block">
          Handle
        </label>
        <div className="mt-3 flex items-baseline gap-2 border-b border-[var(--border-hairline)] pb-3 focus-within:border-[var(--border-strong)]">
          <span className="t-h3 text-text-muted">@</span>
          <input
            id="handle-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="yourname"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="handle-status"
            className="num text-text placeholder:text-text-subtle/60 min-w-0 flex-1 bg-transparent text-lg outline-none"
          />
        </div>
        <p id="handle-status" className="mt-3 min-h-[1.25rem] text-sm" role="status">
          {validation ? (
            <span className="text-danger">{validation}</span>
          ) : handle.length < 3 ? (
            <span className="text-text-subtle">
              3 to 32 lowercase letters, digits, underscores.
            </span>
          ) : checkingAvailable ? (
            <span className="text-text-subtle">Checking the registry…</span>
          ) : taken ? (
            <span className="text-danger">@{handle} is already registered.</span>
          ) : available === true ? (
            <span className="text-success">@{handle} is available.</span>
          ) : (
            <span className="text-text-subtle">Checking the registry…</span>
          )}
        </p>
      </div>

      {problem ? (
        <div className="mt-6">
          <Note tone="warning" role="alert">
            {problem}
          </Note>
        </div>
      ) : null}

      {/* --- the two steps ---------------------------------------------------- */}
      <ol className="mt-8 flex flex-col gap-6">
        <li>
          <p className="t-label text-text-subtle">Step 1 — commit</p>
          <p className="text-text-muted mt-2 max-w-[68ch] text-sm leading-relaxed">
            Publishes a hash of the handle, your address and a random secret. The name itself stays
            private until step two.
          </p>
          <div className="mt-4">
            <ActionButton
              onClick={() => void beginCommit()}
              disabled={
                busy ||
                handle.length < 3 ||
                validation !== null ||
                taken ||
                onChain ||
                !writes.ready
              }
              icon={<ArrowRight className="size-4" />}
            >
              {onChain ? 'Committed' : busy ? 'Preparing…' : 'Commit'}
            </ActionButton>
          </div>
        </li>

        <li>
          <p className="t-label text-text-subtle">Step 2 — claim</p>
          <p className="text-text-muted mt-2 max-w-[68ch] text-sm leading-relaxed">
            {!pending ? (
              'Available once a commitment for this handle exists in this browser.'
            ) : !onChain ? (
              'Waiting for the commit transaction to be mined.'
            ) : secondsRemaining === null ? (
              'Reading the commitment’s age from the contract…'
            ) : secondsRemaining > 0 ? (
              <>
                <span className="num text-text">{secondsRemaining}s</span> to go. MarenRegistry
                refuses a reveal younger than 60 seconds — that delay is what makes copying your
                commitment from the mempool useless.
              </>
            ) : (
              'The commitment is old enough. Reveal the secret to claim the handle.'
            )}
          </p>
          <div className="mt-4">
            <ActionButton
              variant={revealable ? 'primary' : 'secondary'}
              onClick={beginRegister}
              disabled={!revealable || !writes.ready}
              icon={<ArrowRight className="size-4" />}
            >
              {pending ? `Claim @${pending.handle}` : 'Claim'}
            </ActionButton>
          </div>
        </li>
      </ol>

      <Info summary="Why two transactions">
        A single <span className="num">register(&quot;name&quot;)</span> sitting in a public mempool
        is a free option for anyone watching it: copy the calldata, pay more gas, take the name. The
        commitment binds the handle to <em className="not-italic">your</em> address, so a copied
        commitment can only ever be revealed by you. The 60-second minimum age is what stops the two
        transactions being sent in the same block, which would defeat it.
      </Info>

      {pending && onChain ? (
        <div className="mt-6">
          <Note>
            <p className="text-text">A commitment for @{pending.handle} is live.</p>
            <p className="mt-1">
              Its secret is stored in this browser only. Clearing site data before step two loses
              the handle until the commitment expires seven days after it was made.
            </p>
            <div className="mt-4">
              <ActionButton
                variant="quiet"
                onClick={() => {
                  clearCommitment(NETWORK, pending.handle);
                  setPending(null);
                  setCommittedAt(null);
                }}
              >
                Discard this commitment
              </ActionButton>
            </div>
          </Note>
        </div>
      ) : null}
    </AppCard>
  );
}

/** Standalone wrapper for screens that do not already own a transaction runner. */
export function HandleRegistrationCard() {
  const runner = useTxRunner();
  return <HandleRegistration runner={runner} />;
}
