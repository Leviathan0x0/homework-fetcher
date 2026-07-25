/**
 * Client-side image downscaling.
 *
 * Phone photos are routinely 4–8 MB, which serverless platforms reject before
 * the request reaches the API (Vercel caps bodies at ~4.5 MB), and they waste
 * mobile data for everyone reading the chat. Images are resized and re-encoded
 * in the browser before upload; anything that is not a compressible image, or
 * that fails to decode, is returned untouched.
 */

const COMPRESSIBLE_TYPES = new Set(["image/jpeg", "image/pjpeg", "image/png", "image/webp"]);

export interface CompressOptions {
  /** Longest edge of the resulting image, in pixels. */
  maxDimension?: number;
  /** JPEG quality between 0 and 1. */
  quality?: number;
  /** Files below this size are left alone. */
  skipBelowBytes?: number;
}

/** True when the file is an image format worth re-encoding. */
export function isCompressibleImage(file: File): boolean {
  return COMPRESSIBLE_TYPES.has(file.type.toLowerCase());
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read the image.'));
    };
    image.src = url;
  });
}

/**
 * Returns a downscaled copy of an image file, or the original file when
 * compression is not applicable or would not help.
 */
export async function compressImage(file: File, options: CompressOptions = {}): Promise<File> {
  const { maxDimension = 1600, quality = 0.8, skipBelowBytes = 400 * 1024 } = options;

  if (!isCompressibleImage(file) || file.size <= skipBelowBytes) return file;

  try {
    const image = await loadImage(file);
    const largestEdge = Math.max(image.width, image.height);
    const scale = largestEdge > maxDimension ? maxDimension / largestEdge : 1;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));

    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality)
    );
    if (!blob || blob.size >= file.size) return file;

    const newName = file.name.replace(/\.(png|webp|jpeg|jpg)$/i, '') + '.jpg';
    return new File([blob], newName, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
}

/** Human readable file size, used in upload messages. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
