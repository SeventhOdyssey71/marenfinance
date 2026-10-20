import { MUSD_GAS_COMPENSATION } from '@maren/sdk';
import type { Position, ProtocolStats } from '../data/types';

/** Attach the same shared-pool reads to the slider, preview and signing preflight. */
export function borrowPosition(position: Position, stats?: ProtocolStats): Position {
  if (position.route !== 'pooled') return position;
  return {
    ...position,
    // Protocol stats read net debt with interest and pending redistributions included.
    // Mezo's ceiling and pooled ICR compare against composite debt including gas reserve.
    troveTotalDebtWei: stats ? stats.troveNetDebtWei + MUSD_GAS_COMPENSATION : undefined,
    troveCollateralWei: stats?.troveCollateralWei,
    reserveMusdWei: stats?.reserveMusdWei,
    borrowingRateWei: stats?.borrowingRateWei ?? undefined,
    maxBorrowingCapacityWei: stats?.troveMaxBorrowingCapacityWei ?? 0n,
  };
}
