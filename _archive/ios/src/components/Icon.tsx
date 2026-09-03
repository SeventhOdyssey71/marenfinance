import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { text } from '../design/tokens';

/**
 * A deliberately small icon set drawn as 24×24 stroked paths.
 *
 * Line weight is a constant 1.6 at 24px so icons read as hairlines next to BRAND.md's
 * 1px borders rather than as filled glyphs. No icon carries colour by default; callers
 * pass a semantic colour only where the colour means something (§2).
 */
export type IconName =
  | 'arrowUpRight'
  | 'arrowDown'
  | 'arrowRight'
  | 'plus'
  | 'minus'
  | 'check'
  | 'close'
  | 'chevronRight'
  | 'chevronLeft'
  | 'scan'
  | 'lock'
  | 'shield'
  | 'alert'
  | 'clock'
  | 'external'
  | 'copy'
  | 'wallet'
  | 'vault'
  | 'send'
  | 'earn'
  | 'activity'
  | 'settings'
  | 'person'
  | 'faceid'
  | 'backspace';

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
}

export function Icon({ name, size = 20, color = text.primary }: IconProps) {
  const s = {
    stroke: color,
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityRole="image">
      {name === 'arrowUpRight' && <Path d="M7 17 17 7M9 7h8v8" {...s} />}
      {name === 'arrowDown' && <Path d="M12 5v14M6 13l6 6 6-6" {...s} />}
      {name === 'arrowRight' && <Path d="M5 12h14M13 6l6 6-6 6" {...s} />}
      {name === 'plus' && <Path d="M12 5v14M5 12h14" {...s} />}
      {name === 'minus' && <Path d="M5 12h14" {...s} />}
      {name === 'check' && <Path d="M5 13l4 4L19 7" {...s} />}
      {name === 'close' && <Path d="M6 6l12 12M18 6L6 18" {...s} />}
      {name === 'chevronRight' && <Path d="M9 5l7 7-7 7" {...s} />}
      {name === 'chevronLeft' && <Path d="M15 5l-7 7 7 7" {...s} />}
      {name === 'scan' && (
        <>
          <Path
            d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3"
            {...s}
          />
          <Path d="M4 12h16" {...s} />
        </>
      )}
      {name === 'lock' && (
        <>
          <Rect x="4.5" y="10.5" width="15" height="9.5" rx="2" {...s} />
          <Path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" {...s} />
        </>
      )}
      {name === 'shield' && (
        <Path d="M12 3.5 19.5 6.5v5.2c0 4.4-3.1 7.9-7.5 9.3-4.4-1.4-7.5-4.9-7.5-9.3V6.5z" {...s} />
      )}
      {name === 'alert' && (
        <>
          <Path d="M12 4.5 21 20H3z" {...s} />
          <Path d="M12 10v4.2M12 17.2v.1" {...s} />
        </>
      )}
      {name === 'clock' && (
        <>
          <Circle cx="12" cy="12" r="8.2" {...s} />
          <Path d="M12 7.4V12l3 1.8" {...s} />
        </>
      )}
      {name === 'external' && (
        <Path
          d="M13 5h6v6M19 5l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"
          {...s}
        />
      )}
      {name === 'copy' && (
        <>
          <Rect x="9" y="9" width="11" height="11" rx="2.2" {...s} />
          <Path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" {...s} />
        </>
      )}
      {name === 'wallet' && (
        <>
          <Rect x="3.5" y="6" width="17" height="13" rx="2.5" {...s} />
          <Path d="M3.5 10h17M16.5 14.5h.1" {...s} />
        </>
      )}
      {name === 'vault' && (
        <>
          <Rect x="3.5" y="4.5" width="17" height="15" rx="2.5" {...s} />
          <Circle cx="12" cy="12" r="3.6" {...s} />
          <Path d="M12 4.5v3.9M12 15.6v3.9" {...s} />
        </>
      )}
      {name === 'send' && <Path d="M20 4 3.6 10.6l6.2 2.6 2.6 6.2z" {...s} />}
      {name === 'earn' && <Path d="M4 17.5 9.2 12l3.4 3.2L20 7.5M20 7.5h-4.6M20 7.5v4.6" {...s} />}
      {name === 'activity' && <Path d="M3.5 12h4l2.5-6 4 12 2.5-6h4" {...s} />}
      {name === 'settings' && (
        <>
          <Circle cx="12" cy="12" r="3.1" {...s} />
          <Path
            d="M12 3.2v2.3M12 18.5v2.3M20.8 12h-2.3M5.5 12H3.2M18.2 5.8l-1.6 1.6M7.4 16.6l-1.6 1.6M18.2 18.2l-1.6-1.6M7.4 7.4 5.8 5.8"
            {...s}
          />
        </>
      )}
      {name === 'person' && (
        <>
          <Circle cx="12" cy="8.5" r="3.6" {...s} />
          <Path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" {...s} />
        </>
      )}
      {name === 'faceid' && (
        <>
          <Path
            d="M4 8.5V6.5A2.5 2.5 0 0 1 6.5 4h2M15.5 4h2A2.5 2.5 0 0 1 20 6.5v2M20 15.5v2a2.5 2.5 0 0 1-2.5 2.5h-2M8.5 20h-2A2.5 2.5 0 0 1 4 17.5v-2"
            {...s}
          />
          <Path d="M9 9.8v1.4M15 9.8v1.4M12 9.8v3.4h-1M9.4 15.6a4 4 0 0 0 5.2 0" {...s} />
        </>
      )}
      {name === 'backspace' && (
        <>
          <Path d="M9.5 5h9A1.5 1.5 0 0 1 20 6.5v11A1.5 1.5 0 0 1 18.5 19h-9L3.5 12z" {...s} />
          <Path d="M12.5 9.5l4 5M16.5 9.5l-4 5" {...s} />
        </>
      )}
    </Svg>
  );
}
