import React, { useEffect, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { cn } from '../utils/cn';

interface AuthenticatedImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError' | 'onLoad'> {
  /** API path or absolute URL that requires the session cookie. */
  src: string;
  /** Decorative by default — never use the filename as visible fallback text. */
  alt?: string;
  fallbackClassName?: string;
  onReady?: () => void;
  onFail?: () => void;
}

/**
 * Loads protected upload URLs with credentials and renders via a blob URL.
 * Plain <img src="/api/..."> breaks after refresh when the cookie-gated file
 * endpoint returns 401/404 JSON — the browser then shows the alt filename.
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
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;

    setFailed(false);
    setObjectUrl(null);

    (async () => {
      try {
        const res = await apiFetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        // JSON error bodies from the API should never be painted as an image.
        if (blob.type && !blob.type.startsWith('image/') && blob.type !== 'application/octet-stream') {
          throw new Error(`Unexpected type ${blob.type}`);
        }
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      } catch {
        if (!cancelled) {
          setFailed(true);
          onFail?.();
        }
      }
    })();

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
    // Only re-fetch when the URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  if (failed) {
    return (
      <div
        className={cn(
          'flex items-center justify-center w-full h-full bg-neutral-100 dark:bg-neutral-900 text-neutral-400 dark:text-neutral-500',
          fallbackClassName
        )}
        role="img"
        aria-label={alt || 'Image unavailable'}
      >
        <ImageIcon className="w-6 h-6 opacity-60" />
      </div>
    );
  }

  if (!objectUrl) {
    return (
      <div
        className={cn(
          'w-full h-full bg-neutral-100 dark:bg-neutral-900 animate-pulse',
          fallbackClassName,
          className
        )}
        aria-busy="true"
      />
    );
  }

  return (
    <img
      src={objectUrl}
      alt={alt}
      className={className}
      onLoad={() => onReady?.()}
      onError={() => {
        setFailed(true);
        onFail?.();
      }}
      {...rest}
    />
  );
};
