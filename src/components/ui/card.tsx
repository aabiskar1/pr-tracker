import type { ComponentProps } from 'react';
import { cn } from '@/src/lib/utils';

function Card({ className, ...props }: ComponentProps<'div'>) {
    return (
        <div
            data-slot="card"
            className={cn(
                'flex flex-col gap-4 rounded-md border border-border bg-card py-4 text-card-foreground shadow-sm',
                className
            )}
            {...props}
        />
    );
}

function CardHeader({ className, ...props }: ComponentProps<'div'>) {
    return (
        <div
            data-slot="card-header"
            className={cn('grid gap-1 px-4', className)}
            {...props}
        />
    );
}

function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
    return (
        <h3
            data-slot="card-title"
            className={cn('font-semibold leading-none', className)}
            {...props}
        />
    );
}

function CardDescription({ className, ...props }: ComponentProps<'p'>) {
    return (
        <p
            data-slot="card-description"
            className={cn('text-ui-sm text-muted-foreground', className)}
            {...props}
        />
    );
}

function CardContent({ className, ...props }: ComponentProps<'div'>) {
    return (
        <div
            data-slot="card-content"
            className={cn('px-4', className)}
            {...props}
        />
    );
}

function CardFooter({ className, ...props }: ComponentProps<'div'>) {
    return (
        <div
            data-slot="card-footer"
            className={cn('flex items-center px-4', className)}
            {...props}
        />
    );
}

export {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
    CardFooter,
};
