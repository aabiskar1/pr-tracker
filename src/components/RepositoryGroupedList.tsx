import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { FaChevronDown, FaChevronRight } from 'react-icons/fa';
import type { RepositoryGroup } from '../utils/prGrouping';
import { Button } from './ui/button';
import { PullRequestList } from './PullRequestList';

type RepositoryGroupedListProps = {
    groups: RepositoryGroup[];
    collapsedRepositories: ReadonlySet<string>;
    searchActive: boolean;
    onToggle: (key: string) => void;
    onToggleHide: (id: number) => void;
};

export function RepositoryGroupedList({
    groups,
    collapsedRepositories,
    searchActive,
    onToggle,
    onToggleHide,
}: RepositoryGroupedListProps) {
    const prefix = useId();
    const root = useRef<HTMLDivElement>(null);
    const buttons = useRef(new Map<string, HTMLButtonElement>());
    const focused = useRef<{ element: HTMLElement; key: string } | null>(null);
    useEffect(() => {
        const trackFocus = (event: FocusEvent) => {
            const element = event.target as HTMLElement;
            const group = element.closest<HTMLElement>(
                '[data-repository-group]'
            );
            focused.current =
                root.current?.contains(element) && group
                    ? { element, key: group.dataset.repositoryGroup! }
                    : null;
        };
        document.addEventListener('focusin', trackFocus);
        return () => document.removeEventListener('focusin', trackFocus);
    }, []);
    useLayoutEffect(() => {
        const previous = focused.current;
        if (
            previous &&
            (!previous.element.isConnected ||
                previous.element.closest('[hidden]'))
        ) {
            const target =
                buttons.current.get(previous.key) ??
                document.querySelector<HTMLSelectElement>(
                    '[name="pr-grouping"]'
                );
            target?.focus();
        }
    });
    useLayoutEffect(
        () => () => {
            if (root.current?.contains(document.activeElement))
                document
                    .querySelector<HTMLSelectElement>('[name="pr-grouping"]')
                    ?.focus();
        },
        []
    );
    return (
        <div ref={root} className="space-y-3" data-testid="repository-groups">
            {groups.map((group) => {
                const expanded =
                    searchActive || !collapsedRepositories.has(group.key);
                const panelId = `${prefix}-${encodeURIComponent(group.key)}`;
                const Chevron = expanded ? FaChevronDown : FaChevronRight;
                return (
                    <div key={group.key} data-repository-group={group.key}>
                        <h2 className="mb-2">
                            <Button
                                ref={(button) => {
                                    if (button)
                                        buttons.current.set(group.key, button);
                                    else buttons.current.delete(group.key);
                                }}
                                variant="ghost"
                                className="repository-group-toggle h-auto min-h-8 w-full justify-start whitespace-normal py-2 text-left"
                                title={
                                    group.persistable ? group.name : undefined
                                }
                                aria-expanded={expanded}
                                aria-controls={panelId}
                                aria-disabled={searchActive}
                                aria-describedby={
                                    searchActive
                                        ? 'grouping-search-explanation'
                                        : undefined
                                }
                                onClick={() => {
                                    if (!searchActive) onToggle(group.key);
                                }}
                            >
                                <Chevron size={12} aria-hidden="true" />
                                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                                    {group.name}
                                </span>
                                <span className="shrink-0 text-xs font-normal text-muted-foreground">
                                    {group.pullRequests.length}{' '}
                                    {group.pullRequests.length === 1
                                        ? 'PR'
                                        : 'PRs'}
                                </span>
                            </Button>
                        </h2>
                        <div id={panelId} hidden={!expanded}>
                            {expanded && (
                                <PullRequestList
                                    pullRequests={group.pullRequests}
                                    onToggleHide={onToggleHide}
                                />
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
