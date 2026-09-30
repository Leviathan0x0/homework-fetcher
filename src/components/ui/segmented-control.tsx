"use client"

import { cn } from "@/lib/utils"
import { Reicon, type ReiconName } from "@/components/ui/reicon"
import { RadioGroupItem, RadioGroupRoot } from "@/components/ui/radio-group"

type SegmentedControlOption<TValue extends string = string> = {
  value: TValue
  label: string
  icon?: ReiconName
}

type SegmentedControlProps<TValue extends string = string> = {
  options: SegmentedControlOption<TValue>[]
  value: TValue
  onValueChange: (value: TValue) => void
  ariaLabel: string
  className?: string
}

function SegmentedControl<TValue extends string = string>({
  options,
  value,
  onValueChange,
  ariaLabel,
  className,
}: SegmentedControlProps<TValue>) {
  return (
    <RadioGroupRoot
      value={value}
      onValueChange={(next) => onValueChange(next as TValue)}
      aria-label={ariaLabel}
      data-slot="segmented-control"
      className={cn(
        "inline-grid w-full auto-cols-fr grid-flow-col gap-1 rounded-xl bg-muted p-1",
        className
      )}
    >
      {options.map((option) => (
        <RadioGroupItem
          key={option.value}
          value={option.value}
          className="justify-center gap-2 rounded-lg px-2 hover:bg-transparent [&_[data-slot=radio-group-indicator]]:hidden group-data-[checked]/radio:bg-background group-data-[checked]/radio:shadow-sm"
        >
          {option.icon && (
            <Reicon
              name={option.icon}
              size={15}
              className="shrink-0 text-muted-foreground transition-colors duration-200 ease-out group-data-[checked]/radio:text-foreground"
            />
          )}
          <span className="text-xs font-medium">{option.label}</span>
        </RadioGroupItem>
      ))}
    </RadioGroupRoot>
  )
}

export { SegmentedControl }
export type { SegmentedControlOption, SegmentedControlProps }
