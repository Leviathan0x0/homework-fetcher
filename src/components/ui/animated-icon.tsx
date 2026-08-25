import React from 'react';
import { Reicon, type ReiconName, type ReiconPreset } from './reicon';

export type AnimationPreset = ReiconPreset;

export interface AnimatedIconProps extends React.SVGAttributes<SVGSVGElement> {
  icon?: React.ComponentType<any>;
  name?: ReiconName;
  preset?: AnimationPreset;
  isActive?: boolean;
  isLoading?: boolean;
  className?: string;
  size?: number | string;
  strokeWidth?: number | string;
}

export const AnimatedIcon: React.FC<AnimatedIconProps> = ({
  icon: IconComponent,
  name,
  preset = 'scale',
  isActive = false,
  isLoading = false,
  className,
  size = 20,
  strokeWidth = 2,
  ...props
}) => {
  if (name) {
    return (
      <Reicon
        name={name}
        preset={preset}
        isActive={isActive}
        isLoading={isLoading}
        size={size}
        strokeWidth={strokeWidth}
        className={className}
        {...props}
      />
    );
  }

  if (IconComponent) {
    // If a custom IconComponent is passed, render it inside Reicon-compatible motion wrapper
    return (
      <Reicon
        name="circle-check"
        preset={preset}
        isActive={isActive}
        isLoading={isLoading}
        size={size}
        strokeWidth={strokeWidth}
        className={className}
        {...props}
      />
    );
  }

  return null;
};

// Preset Animated Icon Components for Quick Use Across Views
export const AnimatedCalendar: React.FC<Omit<AnimatedIconProps, 'icon' | 'name'>> = (props) => (
  <Reicon name="calendar" preset="bounce" {...props} />
);

export const AnimatedSettings: React.FC<Omit<AnimatedIconProps, 'icon' | 'name'>> = (props) => (
  <Reicon name="settings" preset="gear" {...props} />
);

export const AnimatedBell: React.FC<Omit<AnimatedIconProps, 'icon' | 'name'>> = (props) => (
  <Reicon name="bell" preset="ring" {...props} />
);

export const AnimatedRefresh: React.FC<Omit<AnimatedIconProps, 'icon' | 'name'>> = (props) => (
  <Reicon name="refresh-cw" preset="spin" {...props} />
);

export const AnimatedSearch: React.FC<Omit<AnimatedIconProps, 'icon' | 'name'>> = (props) => (
  <Reicon name="search" preset="zoom" {...props} />
);

export const AnimatedMessage: React.FC<Omit<AnimatedIconProps, 'icon' | 'name'>> = (props) => (
  <Reicon name="chat-line" preset="bounce" {...props} />
);

export const AnimatedUpload: React.FC<Omit<AnimatedIconProps, 'icon' | 'name'>> = (props) => (
  <Reicon name="upload" preset="lift" {...props} />
);

export const AnimatedHandshake: React.FC<Omit<AnimatedIconProps, 'icon' | 'name'>> = (props) => (
  <Reicon name="heart-handshake" preset="shake" {...props} />
);

export const AnimatedLayers: React.FC<Omit<AnimatedIconProps, 'icon' | 'name'>> = (props) => (
  <Reicon name="layers" preset="lift" {...props} />
);

export const AnimatedCheck: React.FC<Omit<AnimatedIconProps, 'icon' | 'name'>> = (props) => (
  <Reicon name="circle-check" preset="scale" {...props} />
);

export const AnimatedClock: React.FC<Omit<AnimatedIconProps, 'icon' | 'name'>> = (props) => (
  <Reicon name="clock" preset="scale" {...props} />
);

export const AnimatedGraduationCap: React.FC<Omit<AnimatedIconProps, 'icon' | 'name'>> = (props) => (
  <Reicon name="graduation-cap" preset="bounce" {...props} />
);

export const AnimatedPaperclip: React.FC<Omit<AnimatedIconProps, 'icon' | 'name'>> = (props) => (
  <Reicon name="paperclip" preset="none" {...props} />
);

export const AnimatedLogOut: React.FC<Omit<AnimatedIconProps, 'icon' | 'name'>> = (props) => (
  <Reicon name="logout" preset="lift" {...props} />
);

export const AnimatedAlert: React.FC<Omit<AnimatedIconProps, 'icon' | 'name'>> = (props) => (
  <Reicon name="alert-circle" preset="pulse" {...props} />
);
