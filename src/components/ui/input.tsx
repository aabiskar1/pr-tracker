import type { ComponentProps } from 'react';
import { cn } from '@/src/lib/utils';

function Input({
    className,
    type = 'text',
    ...props
}: ComponentProps<'input'>) {
    return (
        <input
            data-slot="input"
            type={type}
            className={cn(
                'h-control w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-ui-sm text-foreground shadow-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20',
                className
            )}
            {...props}
        />
    );
}

export { Input };
