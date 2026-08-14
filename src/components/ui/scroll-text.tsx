"use client";

import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/utils";

export interface ScrollTextIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ScrollTextIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
  isAnimated?: boolean;
}

const LINE_VARIANTS: Variants = {
  normal: { pathLength: 1, opacity: 1 },
  animate: {
    pathLength: [0, 1],
    opacity: [0, 1],
    transition: { duration: 0.45, ease: "easeOut" },
  },
};

const ScrollTextIcon = forwardRef<ScrollTextIconHandle, ScrollTextIconProps>(
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
          <path d="M18 17V5a2 2 0 0 0-2-2H8v15a3 3 0 0 1-3 3h13a3 3 0 0 0 3-3v-1Z" />
          <path d="M8 3H6a2 2 0 0 0-2 2v13a3 3 0 0 0 3 3" />
          <motion.path animate={controls} d="M15 8h-4" initial="normal" variants={LINE_VARIANTS} />
          <motion.path animate={controls} d="M15 12h-4" initial="normal" variants={LINE_VARIANTS} />
          <motion.path animate={controls} d="M13 16h-2" initial="normal" variants={LINE_VARIANTS} />
        </svg>
      </div>
    );
  }
);

ScrollTextIcon.displayName = "ScrollTextIcon";
export { ScrollTextIcon };
