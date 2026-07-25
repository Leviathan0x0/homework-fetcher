import * as Haptics from "expo-haptics";
import { useCallback } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { useTheme } from "../theme";
import { MIN_TOUCH_TARGET, radii, spacing } from "../tokens";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "md" | "lg";

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  /**
   * Haptic played on press. Destructive buttons default to a warning notification
   * so a delete never feels like an ordinary tap.
   */
  haptic?: "none" | "light" | "medium" | "success" | "warning";
  style?: StyleProp<ViewStyle>;
  /** Defaults to `label`; set when the label alone is not descriptive. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  icon,
  disabled = false,
  loading = false,
  fullWidth = false,
  haptic,
  style,
  accessibilityLabel,
  accessibilityHint,
}: ButtonProps) {
  const { colors, reduceMotion, spring: springConfig } = useTheme();
  const pressed = useSharedValue(0);

  const isInert = disabled || loading;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: reduceMotion ? 1 : 1 - pressed.value * 0.02 }],
    opacity: 1 - pressed.value * 0.12,
  }));

  const effectiveHaptic = haptic ?? (variant === "destructive" ? "warning" : "light");

  const fireHaptic = useCallback(() => {
    switch (effectiveHaptic) {
      case "none":
        return;
      case "medium":
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        return;
      case "success":
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      case "warning":
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      case "light":
      default:
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [effectiveHaptic]);

  const handlePress = useCallback(() => {
    if (isInert) return;
    fireHaptic();
    onPress();
  }, [fireHaptic, isInert, onPress]);

  const surface: Record<ButtonVariant, ViewStyle> = {
    primary: { backgroundColor: colors.accent },
    secondary: { backgroundColor: colors.fill },
    ghost: { backgroundColor: "transparent" },
    destructive: { backgroundColor: colors.dangerMuted },
  };

  const contentTone = {
    primary: colors.textOnAccent,
    secondary: colors.text,
    ghost: colors.accent,
    destructive: colors.danger,
  }[variant];

  const height = size === "lg" ? 52 : MIN_TOUCH_TARGET;

  return (
    <Animated.View style={[fullWidth ? styles.fullWidth : null, animatedStyle, style]}>
      <Pressable
        onPress={handlePress}
        onPressIn={() => {
          pressed.value = withSpring(1, springConfig);
        }}
        onPressOut={() => {
          pressed.value = withSpring(0, springConfig);
        }}
        disabled={isInert}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: isInert, busy: loading }}
        style={[
          styles.base,
          surface[variant],
          { height, opacity: disabled ? 0.4 : 1 },
          fullWidth ? styles.fullWidth : null,
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={contentTone} />
        ) : (
          <View style={styles.content}>
            {icon ? <Icon name={icon} size={17} color={contentTone} weight="semibold" hierarchical={false} /> : null}
            <Text variant="headline" style={{ color: contentTone }} numberOfLines={1}>
              {label}
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.lg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  fullWidth: {
    alignSelf: "stretch",
    width: "100%",
  },
});
