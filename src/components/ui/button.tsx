import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/src/lib/utils';

const buttonVariants = cva(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-ui-sm font-medium transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:top-0',
    {
        variants: {
            variant: {
                default:
                    'bg-primary text-primary-foreground hover:bg-primary/90',
                secondary:
                    'bg-secondary text-secondary-foreground hover:bg-secondary/80',
                outline:
                    'border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
                ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground',
                destructive:
                    'bg-destructive text-destructive-foreground hover:bg-destructive/90',
            },
            size: {
                default: 'h-control px-3 py-2',
                sm: 'h-8 rounded-sm px-2.5 text-xs',
                lg: 'h-10 px-4',
                icon: 'size-control p-0',
                'icon-sm': 'size-8 rounded-sm p-0',
                'icon-lg': 'size-10 p-0',
            },
        },
        defaultVariants: {
            variant: 'default',
            size: 'default',
        },
    }
);

function Button({
    className,
    variant,
    size,
    type = 'button',
    ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants>) {
    return (
        <button
            data-slot="button"
            type={type}
            className={cn(buttonVariants({ variant, size, className }))}
            {...props}
        />
    );
}

export { Button };
