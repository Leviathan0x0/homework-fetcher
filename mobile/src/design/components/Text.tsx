import { Text as RNText, type StyleProp, type TextProps, type TextStyle } from "react-native";

import { useTheme } from "../theme";
import type { TypographyVariant } from "../tokens";

export type TextTone = "primary" | "secondary" | "tertiary" | "accent" | "danger" | "success" | "warning" | "onAccent";

export interface AppTextProps extends TextProps {
  variant?: TypographyVariant;
  tone?: TextTone;
  /**
   * Use for anything that lines up in a column (sizes, counts, times) so digits
   * keep a constant advance width.
   */
  tabular?: boolean;
  weight?: TextStyle["fontWeight"];
  center?: boolean;
}

/**
 * The only text primitive in the app. Wrapping RNText keeps the type scale, tone
 * palette and Dynamic Type behaviour in one place.
 *
 * `allowFontScaling` is deliberately left at its default (true) — Dynamic Type is
 * part of the accessibility bar. `maxFontSizeMultiplier` caps the very largest
 * settings so dense rows degrade instead of shattering.
 */
export function Text({
  variant = "body",
  tone = "primary",
  tabular = false,
  weight,
  center = false,
  style,
  ...rest
}: AppTextProps) {
  const { colors, typography } = useTheme();

  const toneColor: Record<TextTone, string> = {
    primary: colors.text,
    secondary: colors.textSecondary,
    tertiary: colors.textTertiary,
    accent: colors.accent,
    danger: colors.danger,
    success: colors.success,
    warning: colors.warning,
    onAccent: colors.textOnAccent,
  };

  const base = typography[variant];

  const composed: StyleProp<TextStyle> = [
    {
      fontSize: base.fontSize,
      lineHeight: base.lineHeight,
      letterSpacing: base.letterSpacing,
      fontWeight: weight ?? base.fontWeight,
      color: toneColor[tone],
    },
    tabular ? { fontVariant: ["tabular-nums"] } : null,
    center ? { textAlign: "center" } : null,
    style,
  ];

  return <RNText maxFontSizeMultiplier={1.6} style={composed} {...rest} />;
}
