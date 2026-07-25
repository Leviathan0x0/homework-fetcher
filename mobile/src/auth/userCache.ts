import * as SecureStore from "expo-secure-store";

import type { User } from "../api/types";

/**
 * Last known signed-in user.
 *
 * Cached so the app can open straight into its signed-in state offline instead of
 * blocking on `/api/auth/me`. Kept in secure storage rather than AsyncStorage
 * because it contains the student ID.
 */
const USER_KEY = "homework.user.snapshot.v1";

function isUser(value: unknown): value is User {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.studentId === "string";
}

export async function readCachedUser(): Promise<User | null> {
  try {
    const raw = await SecureStore.getItemAsync(USER_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isUser(parsed)) return null;
    return {
      id: parsed.id,
      studentId: parsed.studentId,
      displayName: parsed.displayName ?? null,
      section: parsed.section ?? null,
    };
  } catch {
    return null;
  }
}

export async function writeCachedUser(user: User): Promise<void> {
  try {
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // Non-fatal: the app just cannot open offline into a signed-in state.
  }
}

export async function clearCachedUser(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(USER_KEY);
  } catch {
    // Non-fatal.
  }
}
