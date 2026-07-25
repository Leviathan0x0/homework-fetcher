import { Image, type ImageContentFit } from "expo-image";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { authHeaders } from "../../api/client";
import { apiUrl } from "../../api/config";
import { downloadAuthedFile, formatFileSize, isImageMimeType, isPdfMimeType } from "../../api/files";
import { inlineErrorMessage } from "../../api/errors";
import { useTheme } from "../theme";
import { MIN_TOUCH_TARGET, radii, spacing } from "../tokens";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

/**
 * Authenticated media.
 *
 * Every API file URL requires the bearer token, so a plain
 * `<Image source={{ uri }} />` renders nothing. These two components are the only
 * sanctioned way to display or open an API file — if you find yourself building a
 * URL by hand somewhere else, use these instead.
 */

export interface AuthedImageProps {
  /** Server-relative `attachmentUrl` / `fileUrl`, or an absolute URL. */
  path: string;
  style?: StyleProp<ViewStyle>;
  contentFit?: ImageContentFit;
  accessibilityLabel: string;
  onPress?: () => void;
  /** Rounded corners. Defaults to the medium radius. */
  radius?: number;
}

/**
 * Image loaded with the auth header.
 *
 * expo-image accepts `headers` on its source, which is what makes this work
 * without pre-downloading. It also gives us the disk cache for free, so a chat
 * thread does not re-fetch every photo on each poll.
 */
export function AuthedImage({
  path,
  style,
  contentFit = "cover",
  accessibilityLabel,
  onPress,
  radius = radii.md,
}: AuthedImageProps) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const content = failed ? (
    <View style={[styles.mediaFallback, { backgroundColor: colors.fill, borderRadius: radius }, style]}>
      <Icon name="image" size={20} color={colors.textTertiary} />
      <Text variant="caption" tone="tertiary">
        Image unavailable
      </Text>
    </View>
  ) : (
    <View style={[{ borderRadius: radius, overflow: "hidden", backgroundColor: colors.fill }, style]}>
      <Image
        source={{ uri: apiUrl(path), headers: authHeaders() }}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
        transition={150}
        cachePolicy="disk"
        accessible
        accessibilityLabel={accessibilityLabel}
        onLoadEnd={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setFailed(true);
        }}
      />
      {loading ? (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <ActivityIndicator size="small" color={colors.textTertiary} />
        </View>
      ) : null}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="imagebutton"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Opens full screen"
    >
      {content}
    </Pressable>
  );
}

export interface AuthedFileRowProps {
  path: string;
  filename: string;
  mimeType: string | null;
  fileSize?: number | null;
  /** Cache key so the same file is not downloaded twice. Use the record id. */
  cacheKey: string;
  /** Tint the row for an outgoing chat bubble. */
  onAccent?: boolean;
}

/**
 * Non-image attachment as a tappable row.
 *
 * Tapping downloads with the auth header, then hands the local file to the OS
 * share sheet — which is how a PDF or document reaches a real viewer without
 * bundling one. Download state is shown inline; a failure explains itself and
 * stays retryable.
 */
export function AuthedFileRow({
  path,
  filename,
  mimeType,
  fileSize,
  cacheKey,
  onAccent = false,
}: AuthedFileRowProps) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const icon: IconName = isPdfMimeType(mimeType) ? "pdf" : isImageMimeType(mimeType) ? "image" : "document";

  const open = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const localUri = await downloadAuthedFile(path, filename, cacheKey);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(localUri, {
          mimeType: mimeType ?? "application/octet-stream",
          dialogTitle: filename,
        });
      } else {
        setError("This device can't open that file type.");
      }
    } catch (caught) {
      setError(inlineErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, [busy, cacheKey, filename, mimeType, path]);

  const foreground = onAccent ? colors.textOnAccent : colors.text;
  const secondary = onAccent ? colors.textOnAccent : colors.textSecondary;

  const sizeLabel = formatFileSize(fileSize);

  return (
    <View>
      <Pressable
        onPress={() => void open()}
        disabled={busy}
        style={[
          styles.fileRow,
          { backgroundColor: onAccent ? "rgba(255,255,255,0.16)" : colors.fill },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${filename}${sizeLabel ? `, ${sizeLabel}` : ""}`}
        accessibilityHint="Downloads and opens this file"
        accessibilityState={{ busy, disabled: busy }}
      >
        <View style={styles.fileIcon}>
          {busy ? (
            <ActivityIndicator size="small" color={secondary} />
          ) : (
            <Icon name={icon} size={18} color={secondary} />
          )}
        </View>
        <View style={styles.fileMeta}>
          <Text variant="footnote" weight="600" numberOfLines={1} style={{ color: foreground }}>
            {filename}
          </Text>
          <Text variant="caption" numberOfLines={1} tabular style={{ color: secondary, opacity: onAccent ? 0.85 : 1 }}>
            {busy ? "Downloading…" : sizeLabel || (mimeType ?? "File")}
          </Text>
        </View>
        {!busy ? <Icon name="download" size={16} color={secondary} /> : null}
      </Pressable>

      {error ? (
        <Text variant="caption" tone="danger" style={styles.fileError}>
          {error} Tap to try again.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  mediaFallback: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  fileIcon: {
    width: 24,
    alignItems: "center",
  },
  fileMeta: {
    flex: 1,
  },
  fileError: {
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
});
