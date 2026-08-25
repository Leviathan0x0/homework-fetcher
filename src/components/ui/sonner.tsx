"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { Reicon } from "@/components/ui/reicon"
import { WanderingEyes } from "@/components/loading-ui/wandering-eyes"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <Reicon name="circle-check" size={16} />,
        info: <Reicon name="info" size={16} />,
        warning: <Reicon name="triangle-alert" size={16} />,
        error: <Reicon name="octagon-x" size={16} />,
        loading: <WanderingEyes className="h-8" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
