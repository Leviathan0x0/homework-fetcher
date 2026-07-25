import { useEffect, useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../theme";
import { radii, spacing } from "../tokens";
import { GlassSurface } from "./GlassSurface";
import { Icon } from "./Icon";
import { Text } from "./Text";

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Optional trailing action rendered in the sheet header (e.g. "Post"). */
  headerRight?: ReactNode;
}

/**
 * Bottom sheet on glass.
 *
 * Kept mounted for one animation beat after `visible` flips to false so the exit
 * transition is not cut off. Under Reduce Motion both directions are instant.
 */
export function Sheet({ visible, onClose, title, children, headerRight }: SheetProps) {
  const { colors, reduceMotion, spring: springConfig, durations } = useTheme();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);

  const progress = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = reduceMotion ? 1 : withSpring(1, springConfig);
      return;
    }
    if (reduceMotion) {
      progress.value = 0;
      setMounted(false);
      return;
    }
    progress.value = withTiming(0, { duration: durations.fast });
    const timer = setTimeout(() => setMounted(false), durations.fast);
    return () => clearTimeout(timer);
  }, [visible, reduceMotion, progress, springConfig, durations.fast]);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * 420 }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  if (!mounted) return null;

  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <Pressable
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop }]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          />
        </Animated.View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboardWrap}
          pointerEvents="box-none"
        >
          <Animated.View style={panelStyle}>
            <GlassSurface
              intensity={90}
              edge="top"
              style={[styles.panel, { paddingBottom: insets.bottom + spacing.lg }]}
            >
              <View style={styles.grabberRow}>
                <View style={[styles.grabber, { backgroundColor: colors.textTertiary }]} />
              </View>

              <View style={[styles.header, { borderBottomColor: colors.separator }]}>
                <Pressable
                  onPress={onClose}
                  hitSlop={12}
                  style={styles.headerButton}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <Icon name="close" size={18} color={colors.textSecondary} weight="semibold" />
                </Pressable>

                <Text variant="headline" numberOfLines={1} style={styles.headerTitle}>
                  {title}
                </Text>

                <View style={styles.headerButton}>{headerRight}</View>
              </View>

              {/* Body sits on an opaque surface — never body text directly on glass. */}
              <View style={[styles.body, { backgroundColor: colors.surface }]}>{children}</View>
            </GlassSurface>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
  },
  keyboardWrap: {
    justifyContent: "flex-end",
  },
  panel: {
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    overflow: "hidden",
  },
  grabberRow: {
    alignItems: "center",
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  grabber: {
    width: 36,
    height: 5,
    borderRadius: radii.pill,
    opacity: 0.5,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: {
    minWidth: 64,
    minHeight: 32,
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
});
