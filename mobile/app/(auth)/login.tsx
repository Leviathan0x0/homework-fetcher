import * as Haptics from "expo-haptics";
import { useCallback, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isApiConfigured } from "../../src/api/config";
import { describeApiError, isApiError } from "../../src/api/errors";
import { useAuth } from "../../src/auth/AuthProvider";
import { Banner, Button, Field, Icon, Text, spacing, useTheme } from "../../src/design";
import { useIsOnline } from "../../src/query/appStateSync";

/**
 * Sign in.
 *
 * The error copy distinguishes the three failures that matter and read very
 * differently to a student:
 *   - 401  a wrong student ID or password — their problem to fix, shown on the form
 *   - 502  the school portal is down — not their fault, say so explicitly
 *   - offline / unreachable — a connectivity problem, retryable
 *
 * Collapsing these into one "login failed" message is the single most common way
 * this screen gets built wrong.
 */
export default function LoginScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const online = useIsOnline();
  const passwordRef = useRef<TextInput>(null);

  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const configured = isApiConfigured();

  const described = error ? describeApiError(error) : null;
  // A rejected credential belongs against the fields; anything else is a banner
  // about the environment, not about what was typed.
  const isCredentialError =
    described?.kind === "invalidCredentials" || described?.kind === "unauthorized" || described?.kind === "validation";

  const submit = useCallback(async () => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await signIn(studentId, password);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Navigation is handled by the group layouts reacting to the new session.
    } catch (caught) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(caught);
      // Keep the student ID, clear only the secret.
      if (isApiError(caught) && (caught.kind === "invalidCredentials" || caught.kind === "unauthorized")) {
        setPassword("");
        passwordRef.current?.focus();
      }
    } finally {
      setSubmitting(false);
    }
  }, [password, signIn, studentId, submitting]);

  const canSubmit = studentId.trim().length > 0 && password.length > 0 && configured;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={[styles.root, { backgroundColor: colors.background }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.xxxl, paddingBottom: insets.bottom + spacing.xxxl },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={styles.brand}>
          <View style={[styles.brandMark, { backgroundColor: colors.accentMuted }]}>
            <Icon name="today" size={26} color={colors.accent} weight="semibold" />
          </View>
          <Text variant="largeTitle">Homework</Text>
          <Text variant="callout" tone="secondary">
            Sign in with your school student ID.
          </Text>
        </View>

        {!configured ? (
          <View style={styles.bannerWrap}>
            <Banner
              tone="danger"
              icon="error"
              message="No API address configured. Set EXPO_PUBLIC_API_BASE_URL, then reload."
            />
          </View>
        ) : null}

        {!online ? (
          <View style={styles.bannerWrap}>
            <Banner tone="neutral" icon="offline" message="You're offline. Reconnect to sign in." />
          </View>
        ) : null}

        {described && !isCredentialError ? (
          <View style={styles.bannerWrap}>
            <Banner
              tone={described.kind === "portalUnreachable" ? "warning" : "danger"}
              message={`${described.title}. ${described.detail}`}
              actionLabel={described.canRetry ? "Retry" : undefined}
              onAction={described.canRetry ? () => void submit() : undefined}
            />
          </View>
        ) : null}

        <View style={styles.form}>
          <Field
            label="Student ID"
            value={studentId}
            onChangeText={(next) => {
              setStudentId(next);
              if (error) setError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
            editable={!submitting}
            placeholder="e.g. 2024F1234"
            onSubmitEditing={() => passwordRef.current?.focus()}
            error={isCredentialError ? described?.detail : null}
          />

          <Field
            ref={passwordRef}
            label="Password"
            value={password}
            onChangeText={(next) => {
              setPassword(next);
              if (error) setError(null);
            }}
            secure
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            editable={!submitting}
            onSubmitEditing={() => void submit()}
          />

          <Button
            label={submitting ? "Signing in…" : "Sign in"}
            onPress={() => void submit()}
            size="lg"
            fullWidth
            loading={submitting}
            disabled={!canSubmit}
            haptic="none"
            accessibilityHint="Signs in to the school homework portal"
          />

          <Text variant="caption" tone="tertiary" center>
            Signing in checks your details with the school portal, which can take a
            few seconds.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xxl,
    gap: spacing.xxl,
  },
  brand: {
    alignItems: "center",
    gap: spacing.xs,
  },
  brandMark: {
    width: 60,
    height: 60,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  bannerWrap: {
    marginHorizontal: -spacing.lg,
  },
  form: {
    gap: spacing.lg,
  },
});
