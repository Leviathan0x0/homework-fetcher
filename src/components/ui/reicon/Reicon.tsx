import React from 'react';
import { Loader as ReiconLoader, File } from 'reicon-react';
import { cn } from '../../../utils/cn';
import {
  REICON_MAP,
  HUGEICONS_MAP,
  REICON_FILLED_MAP,
  REICON_COMPONENT_MAP,
  ReiconPlaneFilledIcon,
  PaperPlaneFilledIcon,
} from './map';
import { ReiconGlass } from './glass';
import type { ReiconPreset, ReiconProps } from './types';

export {
  REICON_MAP,
  HUGEICONS_MAP,
  REICON_FILLED_MAP,
  REICON_COMPONENT_MAP,
  ReiconPlaneFilledIcon,
  PaperPlaneFilledIcon,
  ReiconGlass,
};

const PRESET_CLASSES: Record<ReiconPreset, string> = {
  bounce: 'transition-transform duration-200 active:scale-95',
  rotate: 'transition-transform duration-300 group-hover:rotate-45 hover:rotate-45',
  gear: 'transition-transform duration-500 group-hover:rotate-90 hover:rotate-90',
  ring: 'transition-transform duration-200 group-hover:rotate-12 hover:rotate-12',
  spin: 'animate-spin',
  pulse: 'animate-pulse',
  scale: 'transition-transform duration-200 active:scale-95 hover:scale-105',
  shake: 'transition-transform duration-150 group-hover:-rotate-6 hover:-rotate-6',
  lift: 'transition-transform duration-200 active:scale-95',
  zoom: 'transition-transform duration-200 active:scale-95 hover:scale-105',
  none: '',
};

export const Reicon = React.forwardRef<SVGSVGElement, ReiconProps>(
  (
    {
      name,
      size = 20,
      className,
      preset = 'none',
      isLoading,
      isActive: _isActive,
      isFilled,
      isGlass,
      color,
      strokeWidth = 1.5,
      weight,
      'aria-hidden': ariaHidden,
      'aria-label': ariaLabel,
      role,
      style,
      ...props
    },
    ref
  ) => {
    const isSpinner = Boolean(isLoading || name === 'loader');
    const numericSize = typeof size === 'number' ? size : Number.parseInt(String(size), 10) || 20;
    const numericStrokeWidth =
      typeof strokeWidth === 'number' ? strokeWidth : Number.parseFloat(String(strokeWidth)) || 1.5;
    const isGlassWeight = Boolean(
      !isSpinner && (isGlass || weight === 'Glass' || weight === 'glass')
    );
    const isFilledWeight = Boolean(
      !isGlassWeight &&
        (isFilled || weight === 'Filled' || weight === 'filled' || weight === 'fill' || weight === 'solid')
    );

    const isHidden = ariaHidden !== undefined ? ariaHidden : ariaLabel ? undefined : true;
    const computedRole = role || (ariaLabel ? 'img' : undefined);
    const presetClass = isSpinner ? 'animate-spin' : preset !== 'none' ? PRESET_CLASSES[preset] : '';

    if (isGlassWeight) {
      return (
        <ReiconGlass
          ref={ref}
          name={name}
          size={numericSize}
          color={color}
          className={cn('inline-block shrink-0 align-middle select-none', presetClass, className)}
          aria-hidden={isHidden}
          aria-label={ariaLabel}
          role={computedRole}
          style={style}
          {...props}
        />
      );
    }

    const weightProp: 'Filled' | 'Outline' = isFilledWeight ? 'Filled' : 'Outline';

    const IconComponent = isSpinner ? ReiconLoader : REICON_MAP[name] || File;

    return React.createElement(IconComponent as any, {
      ref,
      size: numericSize,
      weight: weightProp,
      ...(color != null ? { color } : {}),
      strokeWidth: numericStrokeWidth,
      'aria-hidden': isHidden,
      'aria-label': ariaLabel,
      role: computedRole,
      className: cn('inline-block shrink-0 align-middle select-none', presetClass, className),
      style,
      ...props,
    });
  }
);

Reicon.displayName = 'Reicon';
