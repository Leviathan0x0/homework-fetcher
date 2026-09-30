"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "group/switch relative inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <span
        data-slot="switch-track"
        className="flex h-5 w-9 items-center rounded-full bg-input p-0.5 transition-colors duration-200 ease-out group-data-[checked]/switch:bg-primary"
      >
        <SwitchPrimitive.Thumb
          data-slot="switch-thumb"
          className="pointer-events-none size-4 rounded-full bg-background shadow-sm transition-transform duration-200 ease-out group-data-[checked]/switch:translate-x-4"
        />
      </span>
    </SwitchPrimitive.Root>
  )
}

export { Switch }
