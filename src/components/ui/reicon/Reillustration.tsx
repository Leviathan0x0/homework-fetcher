import React from 'react';
import { cn } from '../../../utils/cn';
import { ILLUSTRATION_REGISTRY } from './illustrations';
import type { ReillustrationProps } from './types';

const SIZE_MAP: Record<'sm' | 'md' | 'lg' | 'xl', number> = {
  sm: 96,
  md: 140,
  lg: 180,
  xl: 240,
};

export const Reillustration = React.forwardRef<SVGSVGElement, ReillustrationProps>(
  (
    {
      name,
      size = 'md',
      className,
      interactive: _interactive,
      'aria-hidden': ariaHidden,
      'aria-label': ariaLabel,
      role,
      ...props
    },
    ref
  ) => {
    const illustrationContent = ILLUSTRATION_REGISTRY[name] || null;
    const pixelSize = typeof size === 'number' ? size : SIZE_MAP[size] || SIZE_MAP.md;

    const isHidden = ariaHidden !== undefined ? ariaHidden : ariaLabel ? undefined : true;
    const computedRole = role || (ariaLabel ? 'img' : undefined);

    return (
      <div className="inline-flex items-center justify-center shrink-0">
        <svg
          ref={ref}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 120 120"
          width={pixelSize}
          height={pixelSize}
          aria-hidden={isHidden}
          aria-label={ariaLabel}
          role={computedRole}
          className={cn('shrink-0 select-none overflow-visible', className)}
          {...props}
        >
          {illustrationContent}
        </svg>
      </div>
    );
  }
);

Reillustration.displayName = 'Reillustration';
