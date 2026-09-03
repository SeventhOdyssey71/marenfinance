import { describe, expect, it } from 'vitest';

import { describeSegments, type SegmentOption } from './SegmentedControl.logic';

/**
 * The segmented control's selection logic, tested at the pure boundary.
 *
 * The component renders React Native, which the Node test environment cannot mount, so the
 * logic that actually matters — which segment is selected and what each one announces — is
 * a pure function and is checked here.
 */

type Tab = 'balances' | 'history';

const OPTIONS: SegmentOption<Tab>[] = [
  { key: 'balances', label: 'Balances' },
  { key: 'history', label: 'History' },
];

describe('describeSegments', () => {
  it('marks exactly the selected key', () => {
    const segments = describeSegments(OPTIONS, 'balances');
    expect(segments.map((s) => s.selected)).toEqual([true, false]);
  });

  it('moves the selection when the value changes', () => {
    const segments = describeSegments(OPTIONS, 'history');
    expect(segments.find((s) => s.key === 'history')?.selected).toBe(true);
    expect(segments.find((s) => s.key === 'balances')?.selected).toBe(false);
  });

  it('selects nothing when the value matches no option', () => {
    // A defensive case: an out-of-set value must not silently select the first tab.
    const segments = describeSegments(OPTIONS, 'nope' as Tab);
    expect(segments.every((s) => !s.selected)).toBe(true);
  });

  it('preserves label and key order', () => {
    const segments = describeSegments(OPTIONS, 'balances');
    expect(segments.map((s) => s.key)).toEqual(['balances', 'history']);
    expect(segments.map((s) => s.label)).toEqual(['Balances', 'History']);
  });

  it('falls back to the label for the accessibility label, and honours an explicit one', () => {
    const opts: SegmentOption<Tab>[] = [
      { key: 'balances', label: 'Balances', accessibilityLabel: 'Balances and actions' },
      { key: 'history', label: 'History' },
    ];
    const segments = describeSegments(opts, 'balances');
    expect(segments.find((s) => s.key === 'balances')?.accessibilityLabel).toBe(
      'Balances and actions',
    );
    expect(segments.find((s) => s.key === 'history')?.accessibilityLabel).toBe('History');
  });
});
