import { Image } from "expo-image";
import { useCallback, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { authHeaders } from "../../api/client";
import { apiUrl } from "../../api/config";
import { useTheme } from "../theme";
import { MIN_TOUCH_TARGET, spacing } from "../tokens";
import { GlassSurface } from "./GlassSurface";
import { Icon } from "./Icon";
import { Text } from "./Text";

const MIN_SCALE = 1;
const MAX_SCALE = 4;

export interface ImageLightboxProps {
  visible: boolean;
  onClose: () => void;
  /** Server-relative or absolute image URL. Loaded with the auth header. */
  path: string | null;
  /** Shown in the header, usually the original filename. */
  title?: string | null;
}

/**
 * Full-screen image viewer with pinch-zoom and pan.
 *
 * Gestures are composed rather than nested so pinch and pan work simultaneously,
 * and a double-tap toggles between fit and 2x — the behaviour people expect from
 * Photos. Panning is only enabled while zoomed in, so a swipe at 1x cannot drag
 * the image off centre.
 */
export function ImageLightbox({ visible, onClose, path, title }: ImageLightboxProps) {
  const { colors, reduceMotion, spring: springConfig } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const scale = useSharedValue(MIN_SCALE);
  const savedScale = useSharedValue(MIN_SCALE);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const reset = useCallback(() => {
    scale.value = MIN_SCALE;
    savedScale.value = MIN_SCALE;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    setLoading(true);
    setFailed(false);
  }, [savedScale, savedTranslateX, savedTranslateY, scale, translateX, translateY]);

  const close = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE * 0.7, savedScale.value * event.scale));
    })
    .onEnd(() => {
      if (scale.value < MIN_SCALE) {
        // Rubber-banded below fit: snap back and re-centre.
        scale.value = withSpring(MIN_SCALE, springConfig);
        translateX.value = withSpring(0, springConfig);
        translateY.value = withSpring(0, springConfig);
        savedScale.value = MIN_SCALE;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        return;
      }
      savedScale.value = scale.value;
    });

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((event) => {
      if (scale.value <= MIN_SCALE) return;
      // Clamp travel to the overflow created by the current zoom.
      const maxX = ((scale.value - 1) * width) / 2;
      const maxY = ((scale.value - 1) * height) / 2;
      translateX.value = Math.min(maxX, Math.max(-maxX, savedTranslateX.value + event.translationX));
      translateY.value = Math.min(maxY, Math.max(-maxY, savedTranslateY.value + event.translationY));
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const zoomedIn = scale.value > MIN_SCALE * 1.05;
      const next = zoomedIn ? MIN_SCALE : 2;
      scale.value = reduceMotion ? next : withTiming(next, { duration: 200 });
      savedScale.value = next;
      if (zoomedIn) {
        translateX.value = reduceMotion ? 0 : withTiming(0, { duration: 200 });
        translateY.value = reduceMotion ? 0 : withTiming(0, { duration: 200 });
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      }
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  if (!visible || !path) return null;

  return (
    <Modal visible transparent statusBarTranslucent animationType={reduceMotion ? "none" : "fade"} onRequestClose={close}>
      <View style={[styles.root, { backgroundColor: "#000000" }]}>
        <GestureDetector gesture={composed}>
          <Animated.View style={styles.canvas}>
            <Animated.View style={[{ width, height }, imageStyle]}>
              {failed ? (
                <View style={[styles.center, { width, height }]}>
                  <Icon name="image" size={28} color="rgba(255,255,255,0.6)" />
                  <Text variant="footnote" style={styles.failedText}>
                    This image couldn&apos;t be loaded.
                  </Text>
                </View>
              ) : (
                <Image
                  source={{ uri: apiUrl(path), headers: authHeaders() }}
                  style={{ width, height }}
                  contentFit="contain"
                  cachePolicy="disk"
                  accessible
                  accessibilityLabel={title ?? "Attachment"}
                  onLoadEnd={() => setLoading(false)}
                  onError={() => {
                    setLoading(false);
                    setFailed(true);
                  }}
                />
              )}
            </Animated.View>
          </Animated.View>
        </GestureDetector>

        {loading && !failed ? (
          <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
            <ActivityIndicator color="#FFFFFF" />
          </View>
        ) : null}

        <GlassSurface intensity={60} edge="bottom" style={[styles.header, { paddingTop: insets.top }]}>
          <View style={styles.headerRow}>
            <Text variant="footnote" numberOfLines={1} style={[styles.title, { color: colors.text }]}>
              {title ?? "Attachment"}
            </Text>
            <Pressable
              onPress={close}
              hitSlop={12}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close image"
            >
              <Icon name="close" size={19} color={colors.text} weight="semibold" />
            </Pressable>
          </View>
        </GlassSurface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  canvas: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  failedText: {
    color: "rgba(255,255,255,0.7)",
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  title: {
    flex: 1,
  },
  closeButton: {
    width: 32,
    height: MIN_TOUCH_TARGET,
    alignItems: "flex-end",
    justifyContent: "center",
  },
});
