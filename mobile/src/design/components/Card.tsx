import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "../theme";
import { radii, spacing } from "../tokens";
import { Text } from "./Text";

/** Opaque content container. Body text lives here, never on glass. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.separator }, style]}>
      {children}
    </View>
  );
}

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /** Override tint, e.g. a per-subject colour. */
  tint?: string;
}

/**
 * Compact pill. Read-only when `onPress` is omitted (subject labels), a real
 * toggle button when it is provided (filters). The touch target is padded out to
 * 44pt with `hitSlop` rather than by growing the visual.
 */
export function Chip({ label, selected = false, onPress, tint }: ChipProps) {
  const { colors } = useTheme();
  const background = selected ? colors.accent : (tint ?? colors.fill);
  const foreground = selected ? colors.textOnAccent : colors.textSecondary;

  const content = (
    <View style={[styles.chip, { backgroundColor: background }]}>
      <Text variant="caption" weight="600" numberOfLines={1} style={{ color: foreground }}>
        {label}
      </Text>
    </View>
  );

  if (!onPress) {
    return content;
  }

  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      {content}
    </Pressable>
  );
}

/** Sticky section header used by grouped lists (dates, notification days). */
export function SectionHeader({ title, trailing }: { title: string; trailing?: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
      <Text variant="footnote" tone="secondary" weight="600">
        {title}
      </Text>
      {trailing ? (
        <Text variant="caption" tone="tertiary" tabular>
          {trailing}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  chip: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    alignSelf: "flex-start",
    maxWidth: 180,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
});
