'use client';

import type { ReactNode } from 'react';

import { AppCard, EmptyState } from './primitives';
import { SignIn } from './sign-in';

/**
 * What every screen shows before a wallet is connected.
 *
 * This is the state the app used to hide. A disconnected visitor was handed a populated
 * dashboard built from `mock.ts` — a position, a handle, a history — with a banner
 * admitting it was demo data. The banner was honest; the screen was not, because almost
 * nobody reads a banner before they read the numbers above it.
 *
 * So there is no preview any more. A visitor without a wallet sees this, plus whatever is
 * genuinely public — the oracle price and the pooled trove, in `ProtocolPanel`. That is
 * less impressive than a fake portfolio and it is the only version that survives someone
 * checking it.
 *
 * The instruction is specific per screen, because "connect your wallet" on five screens
 * tells a user nothing about which one they are on or why it is worth connecting.
 */
export function ConnectPrompt({
  title,
  children,
  icon,
}: {
  title: string;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <AppCard className="p-5">
      <EmptyState icon={icon} title={title} action={<SignIn />}>
        {children}
      </EmptyState>
    </AppCard>
  );
}
