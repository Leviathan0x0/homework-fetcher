import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "../theme";
import { radii } from "../tokens";
import { Text } from "./Text";

export interface AvatarProps {
  /** Stable identity used to pick the tint, so a person keeps the same colour. */
  id: string;
  /** Preferred label. Falls back to `studentId` when a display name is not set. */
  displayName?: string | null;
  studentId?: string | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Six muted tints. Deliberately low-chroma so a list of avatars stays calm.
 * Each pairs a fill with a readable foreground in both schemes.
 */
const TINTS = [
  { light: "#D8E4FF", dark: "#1E3358", fg: { light: "#1B4CB8", dark: "#A9C6FF" } },
  { light: "#DCEEDF", dark: "#1D3A28", fg: { light: "#1F6B3C", dark: "#9BD9AF" } },
  { light: "#F6E2D6", dark: "#42291B", fg: { light: "#93502A", dark: "#F0B994" } },
  { light: "#E7DFF6", dark: "#33254D", fg: { light: "#5B3E9E", dark: "#C4B0F0" } },
  { light: "#FBDDE6", dark: "#4A2130", fg: { light: "#A32B52", dark: "#F0A8BF" } },
  { light: "#D6EDF2", dark: "#183A42", fg: { light: "#1D6879", dark: "#9AD5E3" } },
] as const;

function hashToIndex(value: string, buckets: number): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % buckets;
}

/** First letter of each of the first two words, uppercased. */
function initialsOf(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]?.[0] ?? "";
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  const combined = `${first}${second}`.toUpperCase();
  return combined || "?";
}

/**
 * Initials avatar.
 *
 * Note the label precedence: `displayName || studentId`. A raw student ID is a
 * last resort, never the preferred label.
 */
export function Avatar({ id, displayName, studentId, size = 40, style }: AvatarProps) {
  const { isDark } = useTheme();

  const label = displayName?.trim() || studentId?.trim() || "?";
  const tint = TINTS[hashToIndex(id || label, TINTS.length)] ?? TINTS[0];
  const background = isDark ? tint.dark : tint.light;
  const foreground = isDark ? tint.fg.dark : tint.fg.light;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        styles.base,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: background },
        style,
      ]}
    >
      <Text
        variant="subhead"
        weight="600"
        style={{ color: foreground, fontSize: Math.round(size * 0.36), lineHeight: Math.round(size * 0.42) }}
      >
        {initialsOf(label)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    overflow: "hidden",
  },
});
