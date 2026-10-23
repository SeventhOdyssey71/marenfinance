'use client';

import { useId, type CSSProperties, type ReactNode } from 'react';

/**
 * Form controls, built to be operated entirely from a keyboard.
 *
 * The segmented control is a real tab list, the slider is a real `input[type=range]`
 * (so arrows, Home/End and PageUp/PageDown all work without a line of JavaScript), and
 * every control announces its value in words rather than leaving a screen reader to read
 * out a raw number with no unit.
 */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { key: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="bg-surface-inset inline-flex w-full max-w-xl gap-1 rounded-[var(--radius-pill)] p-1"
    >
      {options.map((option) => {
        const active = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.key)}
            className={`h-11 flex-1 rounded-[var(--radius-pill)] px-4 text-sm transition-colors duration-150 ease-out ${
              active
                ? 'bg-surface-raised text-text font-medium shadow-[0_1px_2px_rgba(16,16,19,0.06),0_4px_10px_-6px_rgba(16,16,19,0.18)]'
                : 'text-text-muted hover:text-text'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * An amount field. Values are parsed to 1e18 bigints by the caller — this component
 * never sees a `number`, because a float here would round someone's balance.
 */
export function AmountField({
  value,
  onChange,
  unit,
  label,
  presets,
  hint,
  error,
  max,
  maxLabel,
  onMax,
  inputMode = 'decimal',
}: {
  value: string;
  onChange: (next: string) => void;
  unit: 'BTC' | 'MUSD';
  label: string;
  presets?: readonly { label: string; value: string }[];
  hint?: ReactNode;
  error?: string | null;
  max?: ReactNode;
  maxLabel?: string;
  onMax?: () => void;
  inputMode?: 'decimal' | 'numeric';
}) {
  const id = useId();

  return (
    <div>
      <label htmlFor={id} className="t-label block">
        {label}
      </label>

      <div className="bg-surface-inset mt-2.5 flex items-baseline gap-3 rounded-[var(--radius-input)] px-4 py-3.5 outline-violet-500 transition-[outline-color] duration-150 focus-within:outline-2">
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode={inputMode}
          autoComplete="off"
          spellCheck={false}
          placeholder="0.00"
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={error ? true : undefined}
          className="num text-text placeholder:text-text-subtle min-w-0 flex-1 bg-transparent text-[2rem] font-medium tracking-[-0.03em] outline-none"
        />
        <span className="text-text-muted shrink-0 text-lg">{unit}</span>
      </div>

      {max !== undefined ? (
        <div className="mt-3 flex items-center justify-between gap-4 text-sm">
          <span className="text-text-muted">{maxLabel ?? 'Available'}</span>
          {onMax ? (
            <button
              type="button"
              onClick={onMax}
              /* The visible label is the balance itself, which on its own announces as
                 "0.05 BTC" with no hint that pressing it fills the field. */
              aria-label={`Use the full ${maxLabel ?? 'available'} balance, ${max}`}
              /* The glyph alone was about 18px of tap target. The negative margin keeps
                 the row looking identical while giving it a real one. */
              className="text-text-muted hover:text-text -my-2 min-h-[44px] rounded-[var(--radius-pill)] px-1.5 py-2 transition-colors duration-150 ease-out"
            >
              {max}
            </button>
          ) : (
            <span>{max}</span>
          )}
        </div>
      ) : null}

      {presets && presets.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => onChange(preset.value)}
              className="bg-surface-inset text-text-muted hover:text-text inline-flex h-9 items-center rounded-[var(--radius-pill)] px-3.5 text-[0.8125rem] transition-[color,background-color] duration-150 ease-out hover:bg-[#e8e8ec]"
            >
              {preset.label}
            </button>
          ))}
        </div>
      ) : null}

      {hint ? <div className="text-text-muted mt-3 text-[0.8125rem] leading-relaxed">{hint}</div> : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-danger mt-3 text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const TICKS = 1000n;

/**
 * The borrow slider.
 *
 * `max` IS THE HARD STOP, AND IT IS NOT A PRESENTATION DETAIL. The caller passes the
 * largest amount that can actually succeed — `Preflight.maxWei`, which accounts for Maren's
 * 180% floor, Mezo's per-trove ceiling, and the shared trove's own ratio — so the control
 * physically cannot be dragged into a state the chain would refuse. That is a deliberate
 * choice over validating on submit: a slider that goes somewhere and then throws an error
 * has already told the user they can do something they cannot.
 *
 * When NOTHING can succeed the caller passes `max = 0` and `disabled`, and supplies a
 * `describedBy` pointing at the sentence that says why. A dead control with no explanation
 * is the failure this whole pass exists to remove, so the explanation is wired into the
 * accessibility tree rather than merely printed nearby.
 *
 * Values are bigint throughout. The DOM only ever sees an integer tick index, which is
 * mapped back through `max` — no float ever touches a borrow amount.
 */
export function AmountSlider({
  value,
  max,
  onChange,
  label,
  describeValue,
  marker,
  disabled = false,
  describedBy,
  endLabels,
}: {
  value: bigint;
  max: bigint;
  onChange: (next: bigint) => void;
  label: string;
  /** Spoken value, e.g. "1,240.00 MUSD". Never a bare number. */
  describeValue: (value: bigint) => string;
  marker?: { at: bigint; label: string; onSelect?: () => void };
  disabled?: boolean;
  /** Id of the element explaining why this is disabled. */
  describedBy?: string;
  endLabels?: { start: string; end: string };
}) {
  const displayedValue = value < 0n ? 0n : value > max ? max : value;
  const ticks = max > 0n ? Number((displayedValue * TICKS) / max) : 0;
  const markerPercent = marker && max > 0n ? Number((marker.at * 1000n) / max) / 10 : null;
  const fillPercent = ticks / 10;

  return (
    <div>
      <div className="relative">
        {markerPercent !== null && markerPercent >= 0 && markerPercent <= 100 ? (
          <span
            aria-hidden
            className="bg-text/25 absolute top-1/2 h-4 w-px -translate-y-1/2"
            style={{ left: `${markerPercent}%` }}
          />
        ) : null}
        <input
          type="range"
          min={0}
          max={Number(TICKS)}
          step={1}
          value={ticks}
          disabled={disabled}
          onChange={(event) => onChange((BigInt(event.target.value) * max) / TICKS)}
          aria-label={label}
          aria-valuetext={describeValue(value)}
          aria-describedby={describedBy}
          className="range-maren w-full"
          style={{ '--range-fill': `${fillPercent}%` } as CSSProperties}
        />
      </div>

      {endLabels || marker ? (
        <div className="mt-2 flex items-center justify-between gap-4 text-xs">
          <span className="num text-text-subtle">{endLabels?.start ?? ''}</span>
          {marker ? (
            marker.onSelect ? (
              <button
                type="button"
                onClick={marker.onSelect}
                disabled={disabled}
                className="disabled:text-text-subtle rounded-[var(--radius-pill)] text-violet-400 transition-colors duration-150 ease-out hover:text-violet-400/80"
              >
                {marker.label}
              </button>
            ) : (
              <span className="text-text-subtle">{marker.label}</span>
            )
          ) : null}
          <span className="num text-text-subtle">{endLabels?.end ?? ''}</span>
        </div>
      ) : null}
    </div>
  );
}
