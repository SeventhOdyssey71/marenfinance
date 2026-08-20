/**
 * The segmented control's selection logic, kept free of any React Native import.
 *
 * The component file next to this one renders `react-native`, which the Node test
 * environment cannot parse. So the part worth testing — which segment is selected and what
 * each one announces — lives here as a pure function, and both the component and its test
 * import it from this file.
 */

export interface SegmentOption<T extends string> {
  key: T;
  label: string;
  /** Spoken by VoiceOver when the visible label alone is ambiguous. */
  accessibilityLabel?: string;
}

export interface SegmentDescriptor<T extends string> {
  key: T;
  label: string;
  selected: boolean;
  accessibilityLabel: string;
}

/**
 * Derive per-segment view state. Exactly the option whose key equals `value` is selected;
 * a `value` outside the option set selects nothing rather than silently falling back to
 * the first tab.
 */
export function describeSegments<T extends string>(
  options: SegmentOption<T>[],
  value: T,
): SegmentDescriptor<T>[] {
  return options.map((option) => ({
    key: option.key,
    label: option.label,
    selected: option.key === value,
    accessibilityLabel: option.accessibilityLabel ?? option.label,
  }));
}
