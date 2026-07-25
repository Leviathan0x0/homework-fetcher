import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { useTheme } from "../theme";
import { MIN_TOUCH_TARGET, radii, spacing } from "../tokens";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

export type BannerTone = "info" | "warning" | "danger" | "neutral";

export interface BannerProps {
  tone?: BannerTone;
  icon?: IconName;
  message: string;
  /** Optional inline action, e.g. "Retry". */
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Inline, non-blocking status strip: offline, stale cache, rate limited, failed
 * refresh. Deliberately not a toast — it stays visible while the condition holds
 * and disappears on its own when resolved.
 */
export function Banner({ tone = "info", icon, message, actionLabel, onAction }: BannerProps) {
  const { colors, reduceMotion } = useTheme();

  const palette: Record<BannerTone, { bg: string; fg: string; icon: IconName }> = {
    info: { bg: colors.accentMuted, fg: colors.accent, icon: "info" },
    warning: { bg: colors.fillStrong, fg: colors.warning, icon: "warning" },
    danger: { bg: colors.dangerMuted, fg: colors.danger, icon: "error" },
    neutral: { bg: colors.fill, fg: colors.textSecondary, icon: "info" },
  };

  const chosen = palette[tone];

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(150)}
      exiting={reduceMotion ? undefined : FadeOut.duration(150)}
      accessibilityRole="alert"
      style={[styles.root, { backgroundColor: chosen.bg }]}
    >
      <Icon name={icon ?? chosen.icon} size={16} color={chosen.fg} weight="semibold" />
      <Text variant="footnote" style={[styles.message, { color: chosen.fg }]}>
        {message}
      </Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          hitSlop={10}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text variant="footnote" weight="600" style={{ color: chosen.fg }}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  message: {
    flex: 1,
  },
  action: {
    minHeight: MIN_TOUCH_TARGET - 20,
    justifyContent: "center",
    paddingLeft: spacing.sm,
  },
});

/** Convenience wrapper used by every screen's offline state. */
export function OfflineBanner() {
  return <Banner tone="neutral" icon="offline" message="You're offline. Showing the last saved copy." />;
}

/** Divider that respects the theme separator colour. */
export function Divider({ inset = 0 }: { inset?: number }) {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, marginLeft: inset, backgroundColor: colors.separator }} />;
}
