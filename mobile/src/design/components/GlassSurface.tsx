import { BlurView } from "expo-blur";
import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "../theme";

/**
 * Android only gained a usable native blur in API 31 (Android 12). Below that the
 * `dimezisBlurView` path is slow enough to drop frames while scrolling, so we
 * render an opaque surface instead. Content still scrolls under the chrome; it
 * just is not translucent.
 */
const SUPPORTS_BLUR = Platform.OS === "ios" || (Platform.OS === "android" && Number(Platform.Version) >= 31);

export type GlassEdge = "top" | "bottom" | "all" | "none";

export interface GlassSurfaceProps {
  children?: ReactNode;
  /** Blur strength. Chrome sits around 60-80; sheets slightly higher. */
  intensity?: number;
  /** Which hairline border to draw, so chrome reads as a distinct plane. */
  edge?: GlassEdge;
  style?: StyleProp<ViewStyle>;
  /**
   * Extra scrim opacity on top of the theme default. Raise it when the surface
   * sits over busy imagery and contrast needs help.
   */
  extraScrim?: string;
}

/**
 * Translucent blurred chrome: tab bar, nav headers, sheets, chat composer.
 *
 * Two rules this component enforces so contrast never regresses:
 *  1. A legibility scrim is always painted over the blur (`colors.glassScrim`),
 *     which is what keeps label contrast at WCAG AA over arbitrary content.
 *  2. It is chrome-only. Body text belongs on `colors.surface`, never on glass.
 */
export function GlassSurface({ children, intensity = 70, edge = "none", style, extraScrim }: GlassSurfaceProps) {
  const { colors, isDark } = useTheme();

  const border: ViewStyle = {
    borderColor: colors.glassBorder,
    ...(edge === "top" || edge === "all" ? { borderTopWidth: StyleSheet.hairlineWidth } : null),
    ...(edge === "bottom" || edge === "all" ? { borderBottomWidth: StyleSheet.hairlineWidth } : null),
    ...(edge === "all" ? { borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth } : null),
  };

  if (!SUPPORTS_BLUR) {
    return <View style={[{ backgroundColor: colors.glassFallback }, border, style]}>{children}</View>;
  }

  return (
    <BlurView
      intensity={intensity}
      tint={colors.glassTint}
      experimentalBlurMethod={Platform.OS === "android" ? "dimezisBlurView" : undefined}
      style={[border, style]}
    >
      {/* Legibility scrim — required, not decorative. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.glassScrim }]} />
      {extraScrim ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: extraScrim }]} />
      ) : null}
      {/* A faint top highlight is what sells the material on iOS. */}
      {isDark ? null : (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(255,255,255,0.10)" }]}
        />
      )}
      {children}
    </BlurView>
  );
}
