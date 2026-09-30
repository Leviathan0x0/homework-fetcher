"use client"

import { Radio } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"

import { cn } from "@/lib/utils"

function RadioGroupRoot<TValue extends string | number = string>({
  className,
  ...props
}: RadioGroupPrimitive.Props<TValue>) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn("grid gap-2", className)}
      {...props}
    />
  )
}

function RadioGroupItem({ className, children, ...props }: Radio.Root.Props<string>) {
  return (
    <Radio.Root
      data-slot="radio-group-item"
      className={cn(
        "group/radio flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm outline-none transition-colors duration-200 ease-out hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <span
        data-slot="radio-group-indicator"
        className="grid size-4 shrink-0 place-content-center rounded-full border border-input transition-colors duration-200 ease-out group-data-[checked]/radio:border-primary group-data-[checked]/radio:bg-primary"
      >
        <Radio.Indicator
          data-slot="radio-group-dot"
          className="size-1.5 rounded-full bg-primary-foreground"
        />
      </span>
      {children}
    </Radio.Root>
  )
}

export { RadioGroupItem, RadioGroupRoot }
