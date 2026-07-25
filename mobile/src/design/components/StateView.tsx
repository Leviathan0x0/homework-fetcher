import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

import { describeApiError } from "../../api/errors";
import { useTheme } from "../theme";
import { radii, spacing } from "../tokens";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

/**
 * Pulsing placeholder block. Used instead of a bare spinner for list-shaped
 * content so the first paint already has the right rhythm.
 */
export function Skeleton({ width, height, radius = radii.sm }: { width: number | `${number}%`; height: number; radius?: number }) {
  const { colors, reduceMotion } = useTheme();
  const pulse = useSharedValue(0.55);

  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(withTiming(1, { duration: 850 }), -1, true);
  }, [pulse, reduceMotion]);

  const animated = useAnimatedStyle(() => ({ opacity: reduceMotion ? 0.7 : pulse.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[{ width, height, borderRadius: radius, backgroundColor: colors.skeleton }, animated]}
    />
  );
}

/**
 * Empty state. Every list has one — an empty screen with no explanation is a bug.
 */
export function EmptyState({
  icon = "emptyBox",
  title,
  detail,
  actionLabel,
  onAction,
}: {
  icon?: IconName;
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.centered}>
      <View style={[styles.iconWell, { backgroundColor: colors.fill }]}>
        <Icon name={icon} size={26} color={colors.textTertiary} />
      </View>
      <Text variant="headline" center>
        {title}
      </Text>
      {detail ? (
        <Text variant="footnote" tone="secondary" center style={styles.detail}>
          {detail}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} variant="secondary" style={styles.action} />
      ) : null}
    </View>
  );
}

/**
 * Error state derived from a thrown value.
 *
 * Always renders a retry affordance when the failure is retryable, so a user can
 * never be stranded — the counterpart to "no spinner that hangs forever".
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { colors } = useTheme();
  const described = describeApiError(error);

  return (
    <View style={styles.centered}>
      <View style={[styles.iconWell, { backgroundColor: colors.dangerMuted }]}>
        <Icon name={described.kind === "offline" ? "offline" : "error"} size={26} color={colors.danger} />
      </View>
      <Text variant="headline" center>
        {described.title}
      </Text>
      <Text variant="footnote" tone="secondary" center style={styles.detail}>
        {described.detail}
      </Text>
      {described.canRetry && onRetry ? (
        <Button label="Try again" onPress={onRetry} variant="secondary" icon="refresh" style={styles.action} />
      ) : null}
    </View>
  );
}

/**
 * Bounded spinner for the rare case where a skeleton does not fit. Callers must
 * still pair it with a query timeout — this never becomes an infinite spinner
 * because the API client aborts every request.
 */
export function LoadingState({ label = "Loading…" }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.centered} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={colors.textSecondary} />
      <Text variant="footnote" tone="secondary" center style={styles.detail}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xxxl,
    paddingVertical: spacing.xxxl,
    gap: spacing.sm,
  },
  iconWell: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  detail: {
    maxWidth: 300,
  },
  action: {
    marginTop: spacing.lg,
  },
});
