import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import { IMAGE_COMPRESSION, LIMITS } from "../../api/config";
import { ApiError } from "../../api/errors";
import { formatFileSize } from "../../api/files";
import type { LocalFile } from "../../api/types";

/**
 * Attachment picking and image compression.
 *
 * One module for camera, photo library and document flows so the 4 MB ceiling and
 * the compression settings cannot drift between the chat composer and the
 * classwork upload sheet.
 *
 * Compression is not optional: a modern phone photo is 3–8 MB and would be
 * rejected by the server. Resizing the longest edge to 1600px at JPEG q0.8
 * typically lands under 500 KB while staying perfectly legible for a photo of a
 * whiteboard or an exercise book.
 */

export type PickSource = "camera" | "library" | "document";

/** Thrown when the user declines a permission — callers show this verbatim. */
export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

async function fileSizeOf(uri: string): Promise<number | undefined> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists ? info.size : undefined;
  } catch {
    return undefined;
  }
}

function filenameFrom(uri: string, fallback: string): string {
  const last = uri.split("/").pop();
  return last && last.includes(".") ? last : fallback;
}

/**
 * Resizes and re-encodes an image to fit the upload ceiling.
 *
 * Makes one extra pass at a lower quality if the first result is still too large
 * (very large or very noisy photos), and only then gives up — with a message that
 * states the actual size and the limit rather than a generic failure.
 */
export async function compressImageForUpload(
  uri: string,
  width: number | undefined,
  height: number | undefined,
): Promise<LocalFile> {
  const longestEdge = Math.max(width ?? 0, height ?? 0);
  const needsResize = longestEdge > IMAGE_COMPRESSION.maxEdge;

  // Resize by the longer edge so the aspect ratio is preserved.
  const resize =
    (width ?? 0) >= (height ?? 0)
      ? { width: IMAGE_COMPRESSION.maxEdge }
      : { height: IMAGE_COMPRESSION.maxEdge };
  const resizeAction = needsResize ? [{ resize }] : [];

  const attempt = async (quality: number): Promise<LocalFile> => {
    const result = await ImageManipulator.manipulateAsync(uri, resizeAction, {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return {
      uri: result.uri,
      name: filenameFrom(result.uri, `photo-${Date.now()}.jpg`),
      type: "image/jpeg",
      size: await fileSizeOf(result.uri),
    };
  };

  let compressed = await attempt(IMAGE_COMPRESSION.jpegQuality);

  if (typeof compressed.size === "number" && compressed.size > LIMITS.maxUploadBytes) {
    compressed = await attempt(0.6);
  }

  if (typeof compressed.size === "number" && compressed.size > LIMITS.maxUploadBytes) {
    throw new ApiError({
      kind: "tooLarge",
      message: `This photo is still ${formatFileSize(compressed.size)} after compression. The limit is ${formatFileSize(
        LIMITS.maxUploadBytes,
      )}.`,
    });
  }

  return compressed;
}

/** Takes a photo. Returns null if the user cancels. */
export async function pickFromCamera(): Promise<LocalFile | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new PermissionDeniedError(
      "Camera access is off. Turn it on in Settings to take a photo of your classwork.",
    );
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    // Capture at full quality; compression happens once, below.
    quality: 1,
    exif: false,
  });
  const asset = result.assets?.[0];
  if (result.canceled || !asset) return null;

  return compressImageForUpload(asset.uri, asset.width, asset.height);
}

/** Picks an existing photo. Returns null if the user cancels. */
export async function pickFromLibrary(): Promise<LocalFile | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new PermissionDeniedError("Photo access is off. Turn it on in Settings to attach a photo.");
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 1,
    exif: false,
  });
  const asset = result.assets?.[0];
  if (result.canceled || !asset) return null;

  return compressImageForUpload(asset.uri, asset.width, asset.height);
}

/**
 * Picks any document.
 *
 * Documents cannot be compressed, so an oversized one is rejected immediately
 * with its actual size — there is no point starting an upload that will fail.
 */
export async function pickDocument(): Promise<LocalFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: false,
  });
  const asset = result.assets?.[0];
  if (result.canceled || !asset) return null;

  const size = asset.size ?? (await fileSizeOf(asset.uri));

  if (typeof size === "number" && size > LIMITS.maxUploadBytes) {
    throw new ApiError({
      kind: "tooLarge",
      message: `${asset.name} is ${formatFileSize(size)}. The limit is ${formatFileSize(LIMITS.maxUploadBytes)}.`,
    });
  }

  return {
    uri: asset.uri,
    name: asset.name || filenameFrom(asset.uri, "document"),
    type: asset.mimeType || "application/octet-stream",
    size,
  };
}

/** Dispatches to the right picker. */
export async function pickAttachment(source: PickSource): Promise<LocalFile | null> {
  switch (source) {
    case "camera":
      return pickFromCamera();
    case "library":
      return pickFromLibrary();
    case "document":
      return pickDocument();
  }
}
