import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40',
  {
    variants: {
      variant: {
        default: 'bg-slate-100 text-slate-900 hover:bg-white',
        primary: 'bg-emerald-600 text-white hover:bg-emerald-500',
        outline: 'border border-slate-700 bg-transparent text-slate-200 hover:bg-slate-800',
        ghost: 'bg-transparent text-slate-300 hover:bg-slate-800',
        danger: 'bg-red-600 text-white hover:bg-red-500',
      },
      size: {
        sm: 'h-8 px-3',
        md: 'h-9 px-4',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
)
Button.displayName = 'Button'
