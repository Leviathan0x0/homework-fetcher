import * as FileSystem from "expo-file-system";

import { authHeaders } from "./client";
import { apiUrl } from "./config";
import { ApiError, kindFromStatus } from "./errors";

/**
 * Authenticated file download.
 *
 * API file URLs (`attachmentUrl`, `fileUrl`) are not public — they require the
 * same bearer token as any other request. `FileSystem.downloadAsync` is the only
 * way to attach headers to a download, so every "open this attachment" path goes
 * through here rather than handing a bare URL to the OS.
 */

/** Strips characters that are unsafe in a filesystem path. */
function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+/, "");
  return cleaned.length > 0 ? cleaned.slice(0, 120) : "attachment";
}

/**
 * Downloads to the cache directory and resolves the local `file://` URI.
 *
 * Cached per `cacheKey` (the message or classwork id), so re-opening the same
 * attachment does not re-download it.
 */
export async function downloadAuthedFile(
  pathOrUrl: string,
  originalFilename: string,
  cacheKey: string,
): Promise<string> {
  const cacheRoot = FileSystem.cacheDirectory;
  if (!cacheRoot) {
    // No writable cache (should not happen on a real device); fail with something
    // actionable rather than writing to the string "null".
    throw new ApiError({ kind: "unknown", message: "This device has no writable cache directory." });
  }

  const directory = `${cacheRoot}attachments/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(() => undefined);

  const target = `${directory}${safeFilename(cacheKey)}-${safeFilename(originalFilename)}`;

  const existing = await FileSystem.getInfoAsync(target);
  if (existing.exists && existing.size > 0) return target;

  const result = await FileSystem.downloadAsync(apiUrl(pathOrUrl), target, { headers: authHeaders() });

  if (result.status < 200 || result.status >= 300) {
    // Clean up the partial file so a retry is not served a broken cache hit.
    await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
    throw new ApiError({
      kind: kindFromStatus(result.status),
      message: `Could not download ${originalFilename}.`,
      status: result.status,
    });
  }

  return result.uri;
}

/** Human-readable file size. */
export function formatFileSize(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || Number.isNaN(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** True for MIME types that should render as an inline image preview. */
export function isImageMimeType(mimeType: string | null | undefined): boolean {
  return typeof mimeType === "string" && mimeType.toLowerCase().startsWith("image/");
}

/** True for MIME types the in-app PDF viewer can handle. */
export function isPdfMimeType(mimeType: string | null | undefined): boolean {
  return typeof mimeType === "string" && mimeType.toLowerCase() === "application/pdf";
}
