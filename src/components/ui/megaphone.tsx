"use client";

import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/utils";

export interface MegaphoneIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface MegaphoneIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
  isAnimated?: boolean;
}

const HORN_VARIANTS: Variants = {
  normal: { pathLength: 1, opacity: 1 },
  animate: {
    pathLength: [0, 1],
    opacity: [0.4, 1],
    transition: { duration: 0.42, ease: "easeOut" },
  },
};

const MegaphoneIcon = forwardRef<MegaphoneIconHandle, MegaphoneIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, isAnimated, ...props }, ref) => {
    const controls = useAnimation();
    const controlled = useRef(false);

    useEffect(() => {
      if (isAnimated !== undefined) controls.start(isAnimated ? "animate" : "normal");
    }, [controls, isAnimated]);

    useImperativeHandle(ref, () => {
      controlled.current = true;
      return {
        startAnimation: () => controls.start("animate"),
        stopAnimation: () => controls.start("normal"),
      };
    });

    const enter = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
      if (controlled.current) onMouseEnter?.(event);
      else controls.start("animate");
    }, [controls, onMouseEnter]);
    const leave = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
      if (controlled.current) onMouseLeave?.(event);
      else controls.start("normal");
    }, [controls, onMouseLeave]);

    return (
      <div className={cn(className)} onMouseEnter={enter} onMouseLeave={leave} {...props}>
        <svg fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
          <motion.path animate={controls} d="m3 11 18-5v12L3 14v-3Z" initial="normal" variants={HORN_VARIANTS} />
          <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
          <motion.path animate={controls} d="M7 10v5" initial="normal" variants={HORN_VARIANTS} />
        </svg>
      </div>
    );
  }
);

MegaphoneIcon.displayName = "MegaphoneIcon";
export { MegaphoneIcon };
