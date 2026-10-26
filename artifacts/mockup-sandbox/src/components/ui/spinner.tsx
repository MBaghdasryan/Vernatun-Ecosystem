import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

function Spinner({ className, ref, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      ref={ref as unknown as React.ComponentProps<typeof Loader2Icon>["ref"]}
      {...props}
    />
  )
}

export { Spinner }
