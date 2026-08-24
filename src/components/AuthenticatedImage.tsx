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

    setLoadState({ src, status: 'loading', objectUrl: null });

    (async () => {
      try {
        const res = await apiFetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        // JSON error bodies from the API should never be painted as an image.
        if (blob.type && !blob.type.startsWith('image/') && blob.type !== 'application/octet-stream') {
          throw new Error(`Unexpected type ${blob.type}`);
        }
        const objectUrl = URL.createObjectURL(blob);
        ownedUrl = objectUrl;

        await new Promise<void>((resolve, reject) => {
          const preload = new Image();
          preload.onload = () => resolve();
          preload.onerror = () => reject(new Error('Image decode failed'));
          preload.src = objectUrl;
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
      className={className}
      onLoad={() => onReadyRef.current?.()}
      onError={() => {
        setLoadState({ src, status: 'error', objectUrl: null });
        onFailRef.current?.();
      }}
      {...rest}
    />
  );
};
