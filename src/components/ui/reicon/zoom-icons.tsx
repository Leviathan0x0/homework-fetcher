import React from 'react';
import { cn } from '../../../utils/cn';

export interface ZoomIconProps extends Omit<React.SVGAttributes<SVGSVGElement>, 'color'> {
  color?: string;
  size?: number | string;
  weight?: string;
  strokeWidth?: number | string;
}

const createZoomIcon = (displayName: string, glyph: React.ReactNode) => {
  const Icon = React.forwardRef<SVGSVGElement, ZoomIconProps>(
    ({ color, size = 24, weight: _weight, strokeWidth = 1.5, className, style, ...props }, ref) => (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn('reicon', className)}
        style={color != null ? { color, ...style } : style}
        {...props}
      >
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
        {glyph}
      </svg>
    )
  );
  Icon.displayName = displayName;
  return Icon;
};

export const ZoomInIcon = createZoomIcon('ZoomInIcon', <path d="M11 8v6M8 11h6" />);
export const ZoomOutIcon = createZoomIcon('ZoomOutIcon', <path d="M8 11h6" />);
