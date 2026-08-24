"use client";

import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

export interface ExternalLinkIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ExternalLinkIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
  isAnimated?: boolean;
}

const FRAME_VARIANTS: Variants = {
  normal: { pathLength: 1, opacity: 1 },
  animate: {
    pathLength: [0, 1],
    opacity: [0.35, 1],
    transition: { duration: 0.35, ease: "easeOut" },
  },
};

const ARROW_VARIANTS: Variants = {
  normal: { pathLength: 1, opacity: 1 },
  animate: {
    pathLength: [0, 1],
    opacity: [0, 1],
    transition: { duration: 0.32, delay: 0.12, ease: "easeOut" },
  },
};

const ExternalLinkIcon = forwardRef<ExternalLinkIconHandle, ExternalLinkIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, isAnimated, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);

    useEffect(() => {
      if (isAnimated !== undefined) {
        controls.start(isAnimated ? "animate" : "normal");
      }
    }, [controls, isAnimated]);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;
      return {
        startAnimation: () => controls.start("animate"),
        stopAnimation: () => controls.start("normal"),
      };
    });

    const handleMouseEnter = useCallback(
      (event: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) onMouseEnter?.(event);
        else controls.start("animate");
      },
      [controls, onMouseEnter]
    );

    const handleMouseLeave = useCallback(
      (event: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) onMouseLeave?.(event);
        else controls.start("normal");
      },
      [controls, onMouseLeave]
    );

    return (
      <div
        className={cn("inline-flex items-center justify-center", className)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        {...props}
      >
        <motion.svg
          animate={controls}
          fill="none"
          height={size}
          initial="normal"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          <motion.path d="M15 3h6v6" variants={ARROW_VARIANTS} />
          <motion.path d="M10 14 21 3" variants={ARROW_VARIANTS} />
          <motion.path
            d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
            variants={FRAME_VARIANTS}
          />
        </motion.svg>
      </div>
    );
  }
);

ExternalLinkIcon.displayName = "ExternalLinkIcon";

export { ExternalLinkIcon };
