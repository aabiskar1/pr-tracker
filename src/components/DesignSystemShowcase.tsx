import { useState } from 'react';
import {
    Check,
    CircleAlert,
    Clock3,
    GitPullRequest,
    Search,
    X,
} from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from './ui/card';
import { Input } from './ui/input';
import { Separator } from './ui/separator';
import { Skeleton } from './ui/skeleton';

const statuses = [
    { variant: 'ciPassing' as const, icon: Check, label: 'CI passing' },
    { variant: 'ciFailing' as const, icon: X, label: 'CI failing' },
    { variant: 'ciPending' as const, icon: Clock3, label: 'CI pending' },
    {
        variant: 'reviewApproved' as const,
        icon: Check,
        label: 'Approved',
    },
    {
        variant: 'reviewChanges' as const,
        icon: CircleAlert,
        label: 'Changes requested',
    },
    {
        variant: 'reviewAwaiting' as const,
        icon: Clock3,
        label: 'Awaiting review',
    },
    { variant: 'draft' as const, icon: GitPullRequest, label: 'Draft' },
    {
        variant: 'unavailable' as const,
        icon: CircleAlert,
        label: 'Unavailable',
    },
];

function ThemeSample({ theme }: { theme: 'light' | 'dark' }) {
    return (
        <section
            data-theme={theme}
            data-showcase-theme={theme}
            className="rounded-md border border-border bg-background p-4 text-foreground"
        >
            <h2 className="mb-3 text-base font-semibold capitalize">
                {theme} theme
            </h2>
            <div className="flex flex-wrap gap-2">
                {statuses.map(({ variant, icon: Icon, label }) => (
                    <Badge key={label} variant={variant}>
                        <Icon aria-hidden="true" />
                        {label}
                    </Badge>
                ))}
            </div>
        </section>
    );
}

export function DesignSystemShowcase() {
    const [activations, setActivations] = useState(0);

    return (
        <main
            data-testid="design-system-showcase"
            className="min-h-screen min-w-[720px] space-y-section bg-muted p-4 font-sans text-foreground"
        >
            <header>
                <h1 className="text-xl font-semibold">UI foundation</h1>
                <p className="text-ui-sm text-muted-foreground">
                    Development-only component and theme fixture.
                </p>
            </header>

            <Card>
                <CardHeader>
                    <CardTitle>Buttons and input</CardTitle>
                    <CardDescription>
                        Tab to controls and activate the primary button with the
                        keyboard.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                        <Button
                            data-showcase-action="primary"
                            onClick={() => setActivations((value) => value + 1)}
                        >
                            Primary
                        </Button>
                        <Button variant="secondary">Secondary</Button>
                        <Button variant="outline">Outline</Button>
                        <Button variant="ghost">Ghost</Button>
                        <Button variant="destructive">Destructive</Button>
                        <Button disabled>Disabled</Button>
                        <Button
                            size="icon"
                            variant="outline"
                            aria-label="Search pull requests"
                        >
                            <Search aria-hidden="true" />
                        </Button>
                    </div>
                    <p aria-live="polite" data-showcase-activations>
                        Activations: {activations}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                        <label
                            className="space-y-1 text-ui-sm"
                            htmlFor="demo-search"
                        >
                            <span>Search</span>
                            <Input
                                id="demo-search"
                                placeholder="Search pull requests"
                            />
                        </label>
                        <label
                            className="space-y-1 text-ui-sm"
                            htmlFor="demo-error"
                        >
                            <span>Invalid query</span>
                            <Input
                                id="demo-error"
                                defaultValue="is:pr ???"
                                aria-invalid="true"
                                aria-describedby="demo-error-message"
                            />
                            <span
                                id="demo-error-message"
                                className="text-ui-xs text-destructive"
                            >
                                Enter a valid GitHub search query.
                            </span>
                        </label>
                    </div>
                </CardContent>
                <Separator />
                <CardFooter className="gap-3">
                    <span className="sr-only">Loading example</span>
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="size-8 rounded-full" />
                </CardFooter>
            </Card>

            <div className="grid grid-cols-2 gap-4">
                <ThemeSample theme="light" />
                <ThemeSample theme="dark" />
            </div>
        </main>
    );
}
