import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  Calendar,
  Settings,
  Bell,
  RefreshCw,
  Search,
  MessageSquare,
  Upload,
  Handshake,
  Layers,
  CheckCircle2,
  Clock,
  GraduationCap,
  Paperclip,
  LogOut,
  AlertCircle,
  LucideProps
} from 'lucide-react';
import { cn } from '../../utils/cn';

export type AnimationPreset =
  | 'bounce'
  | 'rotate'
  | 'gear'
  | 'ring'
  | 'spin'
  | 'pulse'
  | 'scale'
  | 'shake'
  | 'lift'
  | 'zoom';

export interface AnimatedIconProps extends LucideProps {
  icon: React.ComponentType<LucideProps>;
  preset?: AnimationPreset;
  isActive?: boolean;
  isLoading?: boolean;
  className?: string;
  size?: number | string;
}

export const AnimatedIcon: React.FC<AnimatedIconProps> = ({
  icon: IconComponent,
  preset = 'scale',
  isActive = false,
  isLoading = false,
  className,
  size = 20,
  strokeWidth = 2,
  ...props
}) => {
  const prefersReducedMotion = useReducedMotion();
  const getMotionVariants = (): any => {
    switch (preset) {
      case 'gear':
        return {
          rest: { rotate: 0 },
          hover: { rotate: 90, transition: { type: 'spring' as const, stiffness: 200, damping: 12 } },
          active: { rotate: 180 },
        };
      case 'ring':
        return {
          rest: { rotate: 0 },
          hover: {
            rotate: [0, -15, 15, -10, 10, -5, 5, 0],
            transition: { duration: 0.6, ease: 'easeInOut' },
          },
          active: { scale: 1.15 },
        };
      case 'spin':
        return {
          rest: { rotate: 0 },
          hover: { rotate: 180, transition: { type: 'spring' as const, stiffness: 260, damping: 18 } },
          active: { rotate: 360 },
        };
      case 'bounce':
        return {
          rest: { y: 0, scale: 1 },
          hover: { y: -3, scale: 1.05, transition: { type: 'spring' as const, stiffness: 400, damping: 10 } },
          active: { y: 0, scale: 0.95 },
        };
      case 'lift':
        return {
          rest: { y: 0, scale: 1 },
          hover: { y: -2, scale: 1.08, transition: { type: 'spring' as const, stiffness: 350, damping: 14 } },
          active: { y: 1, scale: 0.96 },
        };
      case 'zoom':
        return {
          rest: { scale: 1, rotate: 0 },
          hover: { scale: 1.15, rotate: -4, transition: { type: 'spring' as const, stiffness: 300, damping: 12 } },
          active: { scale: 0.95 },
        };
      case 'shake':
        return {
          rest: { x: 0, rotate: 0 },
          hover: {
            x: [-1, 2, -2, 2, 0],
            rotate: [-2, 3, -3, 2, 0],
            transition: { duration: 0.4 },
          },
          active: { scale: 1.1 },
        };
      case 'pulse':
        return {
          rest: { scale: 1, opacity: 1 },
          hover: { scale: [1, 1.15, 1], opacity: [1, 0.85, 1], transition: { duration: 0.5, repeat: Infinity } },
          active: { scale: 0.9 },
        };
      case 'scale':
      default:
        return {
          rest: { scale: 1, rotate: 0 },
          hover: { scale: 1.12, transition: { type: 'spring' as const, stiffness: 350, damping: 15 } },
          active: { scale: 0.92 },
        };
    }
  };

  const variants = getMotionVariants();

  return (
    <motion.div
      className={cn('inline-flex items-center justify-center shrink-0 select-none', className)}
      initial="rest"
      animate={prefersReducedMotion ? 'rest' : isLoading ? { rotate: 360 } : isActive ? 'active' : 'rest'}
      whileHover={prefersReducedMotion ? undefined : 'hover'}
      whileTap={prefersReducedMotion ? undefined : 'active'}
      variants={variants}
      transition={
        prefersReducedMotion
          ? { duration: 0 }
          : isLoading
          ? { repeat: Infinity, duration: 1, ease: 'linear' }
          : { type: 'spring', stiffness: 300, damping: 15 }
      }
    >
      <IconComponent size={size} strokeWidth={strokeWidth} {...props} />
    </motion.div>
  );
};

// Preset Animated Icon Components for Quick Use Across Views

export const AnimatedCalendar: React.FC<Omit<AnimatedIconProps, 'icon'>> = (props) => (
  <AnimatedIcon icon={Calendar} preset="bounce" {...props} />
);

export const AnimatedSettings: React.FC<Omit<AnimatedIconProps, 'icon'>> = (props) => (
  <AnimatedIcon icon={Settings} preset="gear" {...props} />
);

export const AnimatedBell: React.FC<Omit<AnimatedIconProps, 'icon'>> = (props) => (
  <AnimatedIcon icon={Bell} preset="ring" {...props} />
);

export const AnimatedRefresh: React.FC<Omit<AnimatedIconProps, 'icon'>> = (props) => (
  <AnimatedIcon icon={RefreshCw} preset="spin" {...props} />
);

export const AnimatedSearch: React.FC<Omit<AnimatedIconProps, 'icon'>> = (props) => (
  <AnimatedIcon icon={Search} preset="zoom" {...props} />
);

export const AnimatedMessage: React.FC<Omit<AnimatedIconProps, 'icon'>> = (props) => (
  <AnimatedIcon icon={MessageSquare} preset="bounce" {...props} />
);

export const AnimatedUpload: React.FC<Omit<AnimatedIconProps, 'icon'>> = (props) => (
  <AnimatedIcon icon={Upload} preset="lift" {...props} />
);

export const AnimatedHandshake: React.FC<Omit<AnimatedIconProps, 'icon'>> = (props) => (
  <AnimatedIcon icon={Handshake} preset="shake" {...props} />
);

export const AnimatedLayers: React.FC<Omit<AnimatedIconProps, 'icon'>> = (props) => (
  <AnimatedIcon icon={Layers} preset="lift" {...props} />
);

export const AnimatedCheck: React.FC<Omit<AnimatedIconProps, 'icon'>> = (props) => (
  <AnimatedIcon icon={CheckCircle2} preset="scale" {...props} />
);

export const AnimatedClock: React.FC<Omit<AnimatedIconProps, 'icon'>> = (props) => (
  <AnimatedIcon icon={Clock} preset="spin" {...props} />
);

export const AnimatedGraduationCap: React.FC<Omit<AnimatedIconProps, 'icon'>> = (props) => (
  <AnimatedIcon icon={GraduationCap} preset="bounce" {...props} />
);

export const AnimatedPaperclip: React.FC<Omit<AnimatedIconProps, 'icon'>> = (props) => (
  <AnimatedIcon icon={Paperclip} preset="shake" {...props} />
);

export const AnimatedLogOut: React.FC<Omit<AnimatedIconProps, 'icon'>> = (props) => (
  <AnimatedIcon icon={LogOut} preset="lift" {...props} />
);

export const AnimatedAlert: React.FC<Omit<AnimatedIconProps, 'icon'>> = (props) => (
  <AnimatedIcon icon={AlertCircle} preset="pulse" {...props} />
);
