import type { ComponentProps } from 'react';
import { cn } from '@/src/lib/utils';

type SeparatorProps = ComponentProps<'div'> & {
    orientation?: 'horizontal' | 'vertical';
    decorative?: boolean;
};

function Separator({
    className,
    orientation = 'horizontal',
    decorative = true,
    ...props
}: SeparatorProps) {
    return (
        <div
            data-slot="separator"
            role={decorative ? 'none' : 'separator'}
            aria-orientation={decorative ? undefined : orientation}
            className={cn(
                'shrink-0 bg-border',
                orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
                className
            )}
            {...props}
        />
    );
}

export { Separator };
