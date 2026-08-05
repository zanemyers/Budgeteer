import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        "destructive-subtle":
          "border border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive/15 focus-visible:ring-destructive/20",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // Every size was below the 44x44 minimum PRODUCT.md commits to for touch — the smallest
      // were 24px, and every destructive row action used one. On a coarse pointer each grows
      // to at least 44px; on a mouse the compact sizes are unchanged, so desktop density is
      // preserved. Rows getting taller on a phone is the desired outcome, not a side effect.
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3 touch:min-h-11",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3 touch:min-h-11 touch:px-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5 touch:min-h-11",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4 touch:min-h-11",
        icon: "size-9 touch:size-11",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3 touch:size-11",
        "icon-sm": "size-8 touch:size-11",
        "icon-lg": "size-10 touch:size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
