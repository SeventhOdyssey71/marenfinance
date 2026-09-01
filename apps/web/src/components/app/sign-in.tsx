'use client';

import { usePrivy } from '@privy-io/react-auth';

import { privyConfigured } from '@/lib/privy';
import { ArrowUpRight } from '@/components/ui/icons';
import { PillAction } from '@/components/ui/pill-button';
import { Note } from './primitives';
import { ConnectButton } from './wallet';

/**
 * The signed-out call to action.
 *
 * This is the consumer onboarding surface: the first thing a Bitcoin holder sees, and the
 * one place the "no seed phrase" promise is either kept or broken. When Privy is
 * configured it leads with Google — one tap, an embedded Mezo EOA minted behind it — and
 * keeps an external wallet as the quieter second option. When it is NOT configured the
 * whole Google path is absent and this falls back to the existing wallet-connect menu,
 * with one honest line saying why Google is missing rather than showing a button that
 * cannot work.
 *
 * `privyConfigured` is a build-time constant, so exactly one of the two branches mounts
 * for the life of the app — the Privy hook below is only ever called inside the branch
 * that has a `PrivyProvider` above it.
 */
export function SignIn() {
  return privyConfigured ? <PrivySignIn /> : <WalletOnlySignIn />;
}

function PrivySignIn() {
  const { ready, login } = usePrivy();

  return (
    <div className="flex flex-col items-stretch gap-2.5 sm:min-w-[15rem]">
      <button
        type="button"
        disabled={!ready}
        onClick={() => login({ loginMethods: ['google'] })}
        className="bg-text text-bg hover:bg-text/90 active:bg-text/80 group inline-flex h-11 items-center justify-center gap-3 rounded-[var(--radius-pill)] px-5 text-sm font-medium transition-[color,background-color,transform] duration-[120ms] ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          aria-hidden
          className="grid size-6 shrink-0 place-items-center rounded-[var(--radius-pill)] bg-white"
        >
          <GoogleMark className="size-3.5" />
        </span>
        Continue with Google
      </button>

      <PillAction
        variant="secondary"
        disabled={!ready}
        onClick={() => login({ loginMethods: ['wallet'] })}
        icon={<ArrowUpRight className="size-4" />}
      >
        Connect a wallet
      </PillAction>

      <p className="text-text-subtle max-w-[24rem] text-xs leading-relaxed">
        Google creates a Mezo wallet for you — no seed phrase, no extension. You can connect
        your own wallet instead.
      </p>
    </div>
  );
}

/**
 * The fallback when `NEXT_PUBLIC_PRIVY_APP_ID` is unset: the wallet-connect flow exactly as
 * it was, plus one line so the missing Google option reads as unconfigured rather than
 * broken. No fake button, no dead OAuth click.
 */
function WalletOnlySignIn() {
  return (
    <div className="flex flex-col items-start gap-3 sm:min-w-[15rem]">
      <ConnectButton />
      <Note>
        Google sign-in is not configured yet. Set{' '}
        <code className="num text-text-muted">NEXT_PUBLIC_PRIVY_APP_ID</code> to turn it on;
        connecting a wallet works now.
      </Note>
    </div>
  );
}

/** The Google wordmark's "G", in its four brand colours. Decorative — labelled by the button. */
function GoogleMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden focusable={false}>
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}
