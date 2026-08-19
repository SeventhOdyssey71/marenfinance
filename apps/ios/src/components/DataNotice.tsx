import { StyleSheet, View } from 'react-native';

import { base, brand, radius, semanticText, space } from '../design/tokens';
import { Icon } from './Icon';
import { Txt } from './Text';

/**
 * The two things a screen has to be able to say about where its numbers came from.
 *
 * DEGRADED STATES ARE THE PRODUCT, not an afterthought bolted on for robustness. An app
 * that shows Bitcoin-backed debt has exactly two ways to lose a user's trust: quote a
 * figure it could not read, and quote a figure it invented. `ReadFailure` covers the
 * first and `DemoNotice` covers the second, and both are written to be legible to
 * somebody whose money is at stake rather than to a developer reading a log.
 *
 * What `ReadFailure` deliberately does NOT do is render a zero. A read that failed and a
 * balance of nothing are different facts, and only one of them is true; a screen full of
 * zeroes after an RPC timeout tells somebody their money is gone.
 */

/**
 * An RPC read that did not answer.
 *
 * `detail` carries the underlying message verbatim. It is often unlovely, and it is
 * shown anyway: a person deciding whether to retry or to worry is better served by
 * "timed out" than by a rounded "something went wrong", and the message is the only part
 * of this that could tell them which.
 */
export function ReadFailure({
  what,
  detail,
  onRetry,
}: {
  /** What could not be read, as a noun phrase: "your position", "your history". */
  what: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <View
      style={styles.alert}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={`Could not read ${what}. ${detail ?? ''}`}
    >
      <Icon name="alert" size={18} color={semanticText.warning} />
      <View style={styles.body}>
        <Txt variant="small" style={styles.alertTitle}>
          Could not read {what}
        </Txt>
        <Txt variant="small" tone="muted" style={styles.detail}>
          Mezo’s RPC did not answer, so this is unknown rather than empty. Nothing on chain has
          changed and your funds are unaffected.
        </Txt>
        {detail ? (
          <Txt variant="small" tone="muted" style={styles.detail}>
            {detail}
          </Txt>
        ) : null}
        {onRetry ? (
          <Txt
            variant="small"
            style={styles.retry}
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel={`Try reading ${what} again`}
          >
            Try again
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The demo-data banner.
 *
 * Rendered on every screen fed by the mock, without exception and without a way to
 * dismiss it. This is the condition on which the mock module is allowed to exist at all:
 * the danger was never that invented figures exist somewhere in the repo, it was that
 * they could be mistaken for read ones. A label that is always present while the source
 * is selected is what makes the mistake impossible.
 */
export function DemoNotice() {
  return (
    <View
      style={styles.demo}
      accessible
      accessibilityLabel="Demo data. These figures are invented and are not read from Mezo."
    >
      <Icon name="alert" size={15} color={brand.violet400} />
      <Txt variant="small" tone="muted" style={styles.demoText}>
        Demo data. These figures are invented, not read from Mezo. Turn it off in Settings under
        Developer.
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  alert: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: base.surfaceInset,
    borderWidth: StyleSheet.hairlineWidth,
    // A warning hairline rather than a warning fill, per BRAND.md §2: a screen where
    // everything is coloured is a screen where nothing is important. Same alpha as the
    // price banner's, so the two degraded states read as one family.
    borderColor: 'rgba(180,83,9,0.55)',
  },
  body: { flex: 1 },
  alertTitle: { color: semanticText.warning },
  detail: { marginTop: space.xs },
  retry: { color: brand.violet400, marginTop: space.sm },
  demo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.card,
    backgroundColor: brand.violet900,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(91,61,245,0.55)',
    marginBottom: space.lg,
  },
  demoText: { flex: 1 },
});
