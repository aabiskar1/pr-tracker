import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/src/lib/utils';

const badgeVariants = cva(
    'inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-ui-xs font-medium whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:top-0',
    {
        variants: {
            variant: {
                default:
                    'border-transparent bg-primary text-primary-foreground',
                secondary:
                    'border-transparent bg-secondary text-secondary-foreground',
                outline: 'border-border text-foreground',
                destructive:
                    'border-transparent bg-destructive text-destructive-foreground',
                ciPassing:
                    'border-ci-passing-foreground/30 bg-ci-passing text-ci-passing-foreground',
                ciFailing:
                    'border-ci-failing-foreground/30 bg-ci-failing text-ci-failing-foreground',
                ciPending:
                    'border-ci-pending-foreground/30 bg-ci-pending text-ci-pending-foreground',
                reviewApproved:
                    'border-review-approved-foreground/30 bg-review-approved text-review-approved-foreground',
                reviewChanges:
                    'border-review-changes-foreground/30 bg-review-changes text-review-changes-foreground',
                reviewAwaiting:
                    'border-review-awaiting-foreground/30 bg-review-awaiting text-review-awaiting-foreground',
                draft: 'border-status-draft-foreground/30 bg-status-draft text-status-draft-foreground',
                unavailable:
                    'border-status-unavailable-foreground/30 bg-status-unavailable text-status-unavailable-foreground',
            },
        },
        defaultVariants: {
            variant: 'default',
        },
    }
);

function Badge({
    className,
    variant,
    ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
    return (
        <span
            data-slot="badge"
            className={cn(badgeVariants({ variant }), className)}
            {...props}
        />
    );
}

export { Badge };
