import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { type VariantProps } from "class-variance-authority"

import { cn } from "@/utils/lib/utils"
import { buttonVariants } from "./button-variants"

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp: "button" | React.ForwardRefExoticComponent<import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/node_modules/@radix-ui/react-slot/dist/index").SlotProps & React.RefAttributes<HTMLElement>> = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button }
