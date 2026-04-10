import * as React from "react"
import { cn } from "@/lib/utils"

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'destructive' | 'ghost'
  size?: 'default' | 'sm' | 'lg'
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    const base = "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 disabled:pointer-events-none"
    const variants = {
      default: "bg-indigo-600 text-white hover:bg-indigo-700",
      outline: "border border-gray-300 bg-white hover:bg-gray-50 text-gray-700",
      destructive: "bg-red-600 text-white hover:bg-red-700",
      ghost: "hover:bg-gray-100 text-gray-700"
    }
    const sizes = {
      default: "h-10 py-2 px-4 text-sm",
      sm: "h-8 px-3 text-xs",
      lg: "h-12 px-8 text-base"
    }
    return (
      <button className={cn(base, variants[variant], sizes[size], className)} ref={ref} {...props} />
    )
  }
)
Button.displayName = "Button"
export { Button }
