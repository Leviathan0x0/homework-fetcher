import React, { useCallback, useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

export interface AnimatedRegistryIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface AnimatedRegistryIconProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: number;
}

export type AnimatedRegistryIconComponent = React.ForwardRefExoticComponent<
  AnimatedRegistryIconProps & React.RefAttributes<AnimatedRegistryIconHandle>
>;

interface InteractiveAnimatedIconProps extends Omit<AnimatedRegistryIconProps, 'children'> {
  icon: AnimatedRegistryIconComponent;
  animationDuration?: number;
}

export function InteractiveAnimatedIcon({
  icon: Icon,
  animationDuration = 700,
  className,
  size = 20,
  ...props
}: InteractiveAnimatedIconProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const iconRef = useRef<AnimatedRegistryIconHandle>(null);
  const stopTimerRef = useRef<number | null>(null);
  const prefersReducedMotion = useReducedMotion();

  const clearStopTimer = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (!prefersReducedMotion) iconRef.current?.startAnimation();
  }, [prefersReducedMotion]);

  const stop = useCallback(() => {
    clearStopTimer();
    iconRef.current?.stopAnimation();
  }, [clearStopTimer]);

  const playOnce = useCallback(() => {
    if (prefersReducedMotion) return;
    clearStopTimer();
    iconRef.current?.startAnimation();
    stopTimerRef.current = window.setTimeout(() => {
      iconRef.current?.stopAnimation();
      stopTimerRef.current = null;
    }, animationDuration);
  }, [animationDuration, clearStopTimer, prefersReducedMotion]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const target = host.closest<HTMLElement>('button, a, [role="button"]') || host;

    const handlePointerEnter = () => start();
    const handlePointerLeave = () => stop();
    const handlePointerDown = () => playOnce();
    const handleClick = (event: MouseEvent) => {
      if (event.detail === 0) playOnce();
    };
    const handleFocus = () => start();
    const handleBlur = () => stop();

    target.addEventListener('pointerenter', handlePointerEnter);
    target.addEventListener('pointerleave', handlePointerLeave);
    target.addEventListener('pointerdown', handlePointerDown);
    target.addEventListener('click', handleClick);
    target.addEventListener('focus', handleFocus);
    target.addEventListener('blur', handleBlur);

    return () => {
      clearStopTimer();
      target.removeEventListener('pointerenter', handlePointerEnter);
      target.removeEventListener('pointerleave', handlePointerLeave);
      target.removeEventListener('pointerdown', handlePointerDown);
      target.removeEventListener('click', handleClick);
      target.removeEventListener('focus', handleFocus);
      target.removeEventListener('blur', handleBlur);
    };
  }, [clearStopTimer, playOnce, start, stop]);

  return (
    <span ref={hostRef} className="inline-flex shrink-0 items-center justify-center" aria-hidden>
      <Icon ref={iconRef} size={size} className={cn('shrink-0', className)} {...props} />
    </span>
  );
}
