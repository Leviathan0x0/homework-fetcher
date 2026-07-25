import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { setUnauthorizedHandler } from "../api/client";
import { fetchMe, login, logout } from "../api/endpoints";
import { isApiError } from "../api/errors";
import { clearSessionToken, hydrateSession, setSessionToken } from "../api/session";
import type { User } from "../api/types";
import { clearCachedUser, readCachedUser, writeCachedUser } from "./userCache";

export type AuthStatus = "loading" | "signedOut" | "signedIn";

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  /**
   * Set when we are signed in from the cached snapshot but revalidation failed
   * for a network reason. Screens can show an offline banner; the session is
   * still usable.
   */
  revalidationError: unknown;
  signIn: (studentId: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-reads `/api/auth/me`. Used after editing the profile and on foreground. */
  refresh: () => Promise<void>;
  /** Applies a locally known user update without a round trip. */
  applyUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Owns the session lifecycle.
 *
 * Startup order matters for perceived speed and for offline use:
 *   1. Read the credential and the cached user from secure storage.
 *   2. If both exist, enter the signed-in state immediately.
 *   3. Revalidate against `/api/auth/me` in the background.
 *      - rejected  -> sign out (the credential is genuinely dead)
 *      - unreachable -> stay signed in, expose `revalidationError`
 *
 * A 401 from anywhere else in the app funnels into the same `signOut` through
 * `setUnauthorizedHandler`, so there is exactly one way to lose a session.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [revalidationError, setRevalidationError] = useState<unknown>(null);

  // Guards against a burst of concurrent 401s all trying to sign out.
  const signingOut = useRef(false);

  const clearLocalSession = useCallback(async () => {
    await Promise.all([clearSessionToken(), clearCachedUser()]);
    setUser(null);
    setRevalidationError(null);
    setStatus("signedOut");
    // Drop every cached response, including anything persisted to disk, so the
    // next account cannot see the previous one's data.
    queryClient.clear();
  }, [queryClient]);

  const signOut = useCallback(async () => {
    if (signingOut.current) return;
    signingOut.current = true;
    try {
      await logout();
    } finally {
      await clearLocalSession();
      signingOut.current = false;
    }
  }, [clearLocalSession]);

  // One global handler for 401 / expired-school-session responses.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void clearLocalSession();
    });
    return () => setUnauthorizedHandler(null);
  }, [clearLocalSession]);

  const refresh = useCallback(async () => {
    try {
      const fresh = await fetchMe();
      setUser(fresh);
      setRevalidationError(null);
      void writeCachedUser(fresh);
    } catch (error) {
      if (isApiError(error) && (error.kind === "unauthorized" || error.kind === "schoolSessionExpired")) {
        await clearLocalSession();
        return;
      }
      // Network or server trouble: keep the session, surface it for a banner.
      setRevalidationError(error);
    }
  }, [clearLocalSession]);

  // Startup.
  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const [credential, cachedUser] = await Promise.all([hydrateSession(), readCachedUser()]);
      if (cancelled) return;

      if (!credential) {
        setStatus("signedOut");
        return;
      }

      if (cachedUser) {
        // Optimistic: render the app now, verify in the background.
        setUser(cachedUser);
        setStatus("signedIn");
        void refresh();
        return;
      }

      try {
        const fresh = await fetchMe();
        if (cancelled) return;
        setUser(fresh);
        setStatus("signedIn");
        void writeCachedUser(fresh);
      } catch (error) {
        if (cancelled) return;
        if (isApiError(error) && (error.kind === "unauthorized" || error.kind === "schoolSessionExpired")) {
          await clearLocalSession();
          return;
        }
        // We hold a credential but cannot confirm it and have no cached identity.
        // Sending the user back to login would discard a probably-valid session,
        // so surface the failure and let them retry.
        setRevalidationError(error);
        setStatus("signedOut");
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [clearLocalSession, refresh]);

  const signIn = useCallback(
    async (studentId: string, password: string) => {
      const { user: signedInUser, credential } = await login(studentId, password);
      await setSessionToken(credential);
      await writeCachedUser(signedInUser);
      // Never show the previous account's cached lists.
      queryClient.clear();
      setUser(signedInUser);
      setRevalidationError(null);
      setStatus("signedIn");
    },
    [queryClient],
  );

  const applyUser = useCallback((next: User) => {
    setUser(next);
    void writeCachedUser(next);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, revalidationError, signIn, signOut, refresh, applyUser }),
    [status, user, revalidationError, signIn, signOut, refresh, applyUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside <AuthProvider>.");
  }
  return context;
}

/**
 * The signed-in user, for screens that only render inside the authenticated
 * stack. Throws rather than returning null so those screens do not need a guard.
 */
export function useCurrentUser(): User {
  const { user } = useAuth();
  if (!user) {
    throw new Error("useCurrentUser was called outside the authenticated stack.");
  }
  return user;
}
