import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HEADER_HEIGHT } from "../layout";
import { useTheme } from "../theme";
import { MIN_TOUCH_TARGET, spacing } from "../tokens";
import { GlassSurface } from "./GlassSurface";
import { Icon } from "./Icon";
import { Text } from "./Text";

export interface ScreenHeaderProps {
  title: string;
  /** Small line under the title, e.g. the section name or a live status. */
  subtitle?: string;
  /** Shows a back chevron. Defaults to false for tab roots. */
  showBack?: boolean;
  right?: ReactNode;
  /** Rendered under the title row, inside the glass — e.g. a search field. */
  children?: ReactNode;
}

/**
 * Translucent nav header.
 *
 * Absolutely positioned so list content scrolls underneath. Pair it with
 * `useTabScreenPadding` / `useStackScreenPadding` so the first row is not hidden
 * behind it on mount.
 */
export function ScreenHeader({ title, subtitle, showBack = false, right, children }: ScreenHeaderProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <GlassSurface intensity={80} edge="bottom" style={[styles.root, { paddingTop: insets.top }]}>
      <View style={[styles.row, { height: HEADER_HEIGHT }]}>
        {showBack ? (
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Icon name="back" size={20} color={colors.accent} weight="semibold" />
          </Pressable>
        ) : null}

        <View style={styles.titleBlock}>
          <Text variant="headline" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        <View style={styles.rightSlot}>{right}</View>
      </View>
      {children}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  backButton: {
    width: MIN_TOUCH_TARGET - 12,
    height: MIN_TOUCH_TARGET,
    justifyContent: "center",
    marginLeft: -spacing.sm,
  },
  titleBlock: {
    flex: 1,
    justifyContent: "center",
  },
  rightSlot: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
});
