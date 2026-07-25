import { useSafeAreaInsets } from "react-native-safe-area-context";

import { spacing } from "./tokens";

/**
 * Chrome heights.
 *
 * These are fixed rather than measured because the tab bar and header are both
 * translucent and absolutely positioned: content scrolls underneath them, so
 * every scroll view needs to know their height up front to inset its content.
 * Measuring would introduce a first-frame jump.
 */
export const TAB_BAR_HEIGHT = 52;
export const HEADER_HEIGHT = 52;

export interface ScreenPadding {
  /** Content inset so the first row clears the glass header. */
  top: number;
  /** Content inset so the last row clears the glass tab bar. */
  bottom: number;
}

/** Insets for a scroll view inside a tab screen (glass header + glass tab bar). */
export function useTabScreenPadding(extraBottom = 0): ScreenPadding {
  const insets = useSafeAreaInsets();
  return {
    top: insets.top + HEADER_HEIGHT + spacing.sm,
    bottom: insets.bottom + TAB_BAR_HEIGHT + spacing.xl + extraBottom,
  };
}

/** Insets for a pushed screen: glass header, no tab bar. */
export function useStackScreenPadding(extraBottom = 0): ScreenPadding {
  const insets = useSafeAreaInsets();
  return {
    top: insets.top + HEADER_HEIGHT + spacing.sm,
    bottom: insets.bottom + spacing.xl + extraBottom,
  };
}
