import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { cn } from '../utils/cn';
import { Reicon } from './ui/reicon';

interface AuthenticatedImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError' | 'onLoad'> {
  /** API path or absolute URL that requires the session cookie. */
  src: string;
  /** Decorative by default - never use the filename as visible fallback text. */
  alt?: string;
  fallbackClassName?: string;
  onReady?: () => void;
  onFail?: () => void;
}

type ImageLoadState = {
  src: string;
  status: 'loading' | 'ready' | 'error';
  objectUrl: string | null;
};

// Recently fetched blobs, so re-mounting an image (switching threads, opening
// the lightbox on an image already in the list) does not hit the network again.
const BLOB_CACHE_MAX_ENTRIES = 40;
const BLOB_CACHE_MAX_BYTES = 40 * 1024 * 1024;
const blobCache = new Map<string, Blob>();
let blobCacheBytes = 0;

function cacheBlob(key: string, blob: Blob) {
  if (blob.size > BLOB_CACHE_MAX_BYTES / 4) return;
  const previous = blobCache.get(key);
  if (previous) blobCacheBytes -= previous.size;
  blobCache.delete(key);
  blobCache.set(key, blob);
  blobCacheBytes += blob.size;
  for (const [oldKey, oldBlob] of blobCache) {
    if (blobCache.size <= BLOB_CACHE_MAX_ENTRIES && blobCacheBytes <= BLOB_CACHE_MAX_BYTES) break;
    blobCache.delete(oldKey);
    blobCacheBytes -= oldBlob.size;
  }
}

function evictBlob(key: string) {
  const blob = blobCache.get(key);
  if (!blob) return;
  blobCache.delete(key);
  blobCacheBytes -= blob.size;
}

async function fetchImageBlob(src: string): Promise<Blob> {
  const cached = blobCache.get(src);
  if (cached) {
    // Refresh recency.
    blobCache.delete(src);
    blobCache.set(src, cached);
    return cached;
  }
  const res = await apiFetch(src);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  // JSON error bodies from the API should never be painted as an image.
  if (blob.type && !blob.type.startsWith('image/') && blob.type !== 'application/octet-stream') {
    throw new Error(`Unexpected type ${blob.type}`);
  }
  cacheBlob(src, blob);
  return blob;
}

/**
 * Loads protected upload URLs with credentials and renders via a blob URL.
 * Plain <img src="/api/..."> breaks after refresh when the cookie-gated file
 * endpoint returns 401/404 JSON - the browser then shows the alt filename.
 */
export const AuthenticatedImage: React.FC<AuthenticatedImageProps> = ({
  src,
  alt = '',
  className,
  fallbackClassName,
  onReady,
  onFail,
  ...rest
}) => {
  const [loadState, setLoadState] = useState<ImageLoadState>({
    src,
    status: 'loading',
    objectUrl: null,
  });
  const onReadyRef = useRef(onReady);
  const onFailRef = useRef(onFail);
  onReadyRef.current = onReady;
  onFailRef.current = onFail;

  useEffect(() => {
    let cancelled = false;
    let ownedUrl: string | null = null;
    let signalCancel: (() => void) | null = null;

    setLoadState((prev) =>
      prev.src === src && prev.status === 'loading' ? prev : { src, status: 'loading', objectUrl: null }
    );

    (async () => {
      try {
        const blob = await fetchImageBlob(src);
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        ownedUrl = objectUrl;

        await new Promise<void>((resolve, reject) => {
          const preload = new Image();
          preload.onload = () => resolve();
          preload.onerror = () => reject(new Error('Image decode failed'));
          preload.src = objectUrl;
          // Cancel the decode wait if the effect is torn down first.
          signalCancel = () => {
            preload.onload = null;
            preload.onerror = null;
            preload.src = '';
            resolve();
          };
        });

        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          ownedUrl = null;
          return;
        }
        // Hand ownership to React state - effect cleanup must not revoke this URL.
        ownedUrl = null;
        setLoadState({ src, status: 'ready', objectUrl });
      } catch {
        evictBlob(src);
        if (ownedUrl) {
          URL.revokeObjectURL(ownedUrl);
          ownedUrl = null;
        }
        if (!cancelled) {
          setLoadState({ src, status: 'error', objectUrl: null });
          onFailRef.current?.();
        }
      }
    })();

    return () => {
      cancelled = true;
      signalCancel?.();
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    };
  }, [src]);

  // Revoke blob URLs that are owned by state when they are replaced or on unmount.
  useEffect(() => {
    const url = loadState.objectUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [loadState.objectUrl]);

  const isCurrentSource = loadState.src === src;

  if (isCurrentSource && loadState.status === 'error') {
    return (
      <div
        className={cn(
          'flex items-center justify-center w-full h-full bg-neutral-100 dark:bg-neutral-900 text-neutral-400 dark:text-neutral-500',
          fallbackClassName
        )}
        role="img"
        aria-label={alt ? `${alt} unavailable` : 'Image unavailable'}
      >
        <div className="flex flex-col items-center justify-center gap-1.5 px-3 text-center">
          <Reicon name="image" size={24} className="opacity-60" />
          <span className="text-xs font-medium">Image unavailable</span>
        </div>
      </div>
    );
  }

  if (!isCurrentSource || loadState.status !== 'ready' || !loadState.objectUrl) {
    return (
      <div
        className={cn(
          'w-full h-full bg-neutral-100 dark:bg-neutral-900 animate-pulse',
          fallbackClassName,
          className
        )}
        aria-busy="true"
        role="status"
        aria-label={alt ? `Loading ${alt}` : 'Loading image'}
      />
    );
  }

  return (
    <img
      src={loadState.objectUrl}
      alt={alt}
      decoding="async"
      className={className}
      onLoad={() => onReadyRef.current?.()}
      onError={() => {
        evictBlob(src);
        setLoadState({ src, status: 'error', objectUrl: null });
        onFailRef.current?.();
      }}
      {...rest}
    />
  );
};
