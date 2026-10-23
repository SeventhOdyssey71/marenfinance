'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { Segmented } from '@/components/app/controls';
import { PageHeader } from '@/components/app/primitives';
import EarnPage from '../earn/page';
import VaultPage from '../vault/page';

/**
 * Finance — Vault and Earn under one roof.
 *
 * These are the two things a Maren account does with money it holds: borrow against
 * Bitcoin (Vault) and put idle MUSD to work (Earn). Talise groups saving and yield
 * into one destination; this does the same, with a sub-nav rather than two peers in
 * the shell. The section bodies are the existing screens verbatim — nothing about the
 * borrow slider, the preflight or the honest-yield copy changes; they are reached from
 * here as well as from their own `/app/vault` and `/app/earn` routes.
 */
type Section = 'vault' | 'earn';

const SECTIONS = [
  { key: 'vault' as const, label: 'Vault' },
  { key: 'earn' as const, label: 'Earn' },
];

export default function FinancePage() {
  /**
   * `/app/finance?section=earn` opens the Earn tab directly, so Home's "Earn" and "Open
   * Earn" links land on the right sub-section instead of always on Vault. Read once into
   * the initial state: after mount the segmented control owns the choice, so following the
   * deep-link and then tapping Vault is not fought by the query string that is still in the
   * URL. Anything other than `earn` falls back to Vault, the default destination.
   */
  const params = useSearchParams();
  const [section, setSection] = useState<Section>(
    params.get('section') === 'earn' ? 'earn' : 'vault',
  );

  return (
    <div>
      <PageHeader
        title="Finance"
        description="Borrow MUSD against your Bitcoin in the vault, or move idle MUSD into Earn."
      />

      <Segmented options={SECTIONS} value={section} onChange={setSection} label="Finance section" />

      {/* The two sections are full screens in their own right (they are also routes), so
          they get the whole column below the switch. Each one drops its own title here:
          the header above and the selected tab already say where you are. */}
      <div className="mt-8">{section === 'vault' ? <VaultPage /> : <EarnPage />}</div>
    </div>
  );
}
