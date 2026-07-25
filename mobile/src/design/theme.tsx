import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import {
  darkPalette,
  durations,
  lightPalette,
  radii,
  spacing,
  spring,
  typography,
  type Palette,
} from "./tokens";

export type ColorSchemeName = "light" | "dark";

export interface Theme {
  scheme: ColorSchemeName;
  isDark: boolean;
  colors: Palette;
  spacing: typeof spacing;
  radii: typeof radii;
  typography: typeof typography;
  durations: typeof durations;
  spring: typeof spring;
  /** True when the OS "Reduce Motion" switch is on. Skip transitions, keep state changes instant. */
  reduceMotion: boolean;
}

const ThemeContext = createContext<Theme | null>(null);

/**
 * Theme is driven entirely by the system setting — there is no in-app override in
 * v1. Settings surfaces the current value read-only so the mismatch never
 * confuses anyone.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const reduceMotion = useReducedMotion();

  const theme = useMemo<Theme>(() => {
    const scheme: ColorSchemeName = systemScheme === "dark" ? "dark" : "light";
    return {
      scheme,
      isDark: scheme === "dark",
      colors: scheme === "dark" ? darkPalette : lightPalette,
      spacing,
      radii,
      typography,
      durations,
      spring,
      reduceMotion,
    };
  }, [systemScheme, reduceMotion]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error("useTheme must be used inside <ThemeProvider>.");
  }
  return theme;
}

/**
 * Duration helper that collapses to 0 when Reduce Motion is on, so callers can
 * keep a single code path.
 */
export function useMotionDuration(key: keyof typeof durations): number {
  const { durations: d, reduceMotion } = useTheme();
  return reduceMotion ? 0 : d[key];
}
