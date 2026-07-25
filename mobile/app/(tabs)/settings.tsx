import { useCallback, useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, View } from "react-native";

import { updateDisplayName } from "../../src/api/endpoints";
import { inlineErrorMessage } from "../../src/api/errors";
import { API_BASE_URL } from "../../src/api/config";
import { useAuth, useCurrentUser } from "../../src/auth/AuthProvider";
import {
  Avatar,
  Banner,
  Button,
  Card,
  Divider,
  Field,
  Icon,
  ScreenHeader,
  Text,
  spacing,
  useTabScreenPadding,
  useTheme,
} from "../../src/design";
import { useIsOnline } from "../../src/query/appStateSync";

/**
 * Settings.
 *
 * Theme is reported, not chosen: the app follows the system setting, so offering
 * an in-app override here would just be a second source of truth.
 */
export default function SettingsScreen() {
  const { colors, scheme } = useTheme();
  const padding = useTabScreenPadding();
  const user = useCurrentUser();
  const { signOut, applyUser, revalidationError } = useAuth();
  const online = useIsOnline();

  const [draftName, setDraftName] = useState(user.displayName ?? "");
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = draftName.trim() !== (user.displayName ?? "").trim();

  const saveName = useCallback(async () => {
    setNameError(null);
    setSaved(false);
    setSaving(true);
    try {
      const updated = await updateDisplayName(draftName);
      applyUser(updated);
      setSaved(true);
    } catch (caught) {
      setNameError(inlineErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }, [applyUser, draftName]);

  const confirmSignOut = useCallback(() => {
    Alert.alert("Sign out?", "You'll need your student ID and password to sign back in.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut() },
    ]);
  }, [signOut]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Settings" />
      <ScrollView
        contentContainerStyle={{ paddingTop: padding.top, paddingBottom: padding.bottom, gap: spacing.xl }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {!online ? <Banner tone="neutral" icon="offline" message="You're offline. Changes can't be saved yet." /> : null}
        {revalidationError ? (
          <Banner tone="warning" message={`Couldn't confirm your session. ${inlineErrorMessage(revalidationError)}`} />
        ) : null}

        <View style={styles.identity}>
          <Avatar id={user.id} displayName={user.displayName} studentId={user.studentId} size={64} />
          <Text variant="title">{user.displayName ?? user.studentId}</Text>
          <Text variant="footnote" tone="secondary" tabular>
            {user.studentId}
            {user.section ? ` · ${user.section}` : ""}
          </Text>
        </View>

        <View style={styles.section}>
          <Text variant="caption" tone="tertiary" weight="600" style={styles.sectionLabel}>
            DISPLAY NAME
          </Text>
          <Card style={styles.cardPadding}>
            <Field
              label="Shown to classmates instead of your student ID"
              value={draftName}
              onChangeText={(next) => {
                setDraftName(next);
                setNameError(null);
                setSaved(false);
              }}
              placeholder={user.studentId}
              maxLength={80}
              autoCapitalize="words"
              editable={!saving}
              error={nameError}
              hint={saved ? "Saved." : undefined}
            />
            <Button
              label={saving ? "Saving…" : "Save name"}
              onPress={() => void saveName()}
              variant="secondary"
              disabled={!dirty || saving || !online}
              loading={saving}
              fullWidth
              style={styles.saveButton}
            />
          </Card>
        </View>

        <View style={styles.section}>
          <Text variant="caption" tone="tertiary" weight="600" style={styles.sectionLabel}>
            ABOUT
          </Text>
          <Card>
            <InfoRow icon="section" label="Section" value={user.section ?? "Not set yet"} />
            <Divider inset={spacing.xxxl + spacing.md} />
            <InfoRow icon="theme" label="Appearance" value={`${scheme === "dark" ? "Dark" : "Light"} · follows system`} />
            <Divider inset={spacing.xxxl + spacing.md} />
            <InfoRow icon="info" label="API" value={API_BASE_URL ?? "Not configured"} />
            <Divider inset={spacing.xxxl + spacing.md} />
            <InfoRow icon="document" label="Platform" value={`${Platform.OS} ${Platform.Version}`} />
          </Card>
        </View>

        <View style={styles.section}>
          <Button
            label="Sign out"
            onPress={confirmSignOut}
            variant="destructive"
            icon="signOut"
            fullWidth
            style={styles.signOut}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function InfoRow({ icon, label, value }: { icon: "section" | "theme" | "info" | "document"; label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.infoRow} accessible accessibilityLabel={`${label}: ${value}`}>
      <View style={[styles.infoIcon, { backgroundColor: colors.fill }]}>
        <Icon name={icon} size={15} color={colors.textSecondary} />
      </View>
      <Text variant="callout" style={styles.infoLabel}>
        {label}
      </Text>
      <Text variant="footnote" tone="secondary" numberOfLines={1} style={styles.infoValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  identity: {
    alignItems: "center",
    gap: spacing.xs,
    paddingTop: spacing.md,
  },
  section: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  sectionLabel: {
    paddingLeft: spacing.xs,
    letterSpacing: 0.6,
  },
  cardPadding: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  saveButton: {
    marginTop: 0,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 48,
  },
  infoIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  infoLabel: {
    flexShrink: 0,
  },
  infoValue: {
    flex: 1,
    textAlign: "right",
  },
  signOut: {
    marginTop: spacing.sm,
  },
});
