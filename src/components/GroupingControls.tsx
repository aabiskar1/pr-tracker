import { useId } from 'react';
import type { GroupingPreferences } from '../types';
import { Button } from './ui/button';

type GroupingControlsProps = {
    mode: GroupingPreferences['mode'];
    onModeChange: (mode: GroupingPreferences['mode']) => void;
    prCount: number;
    repositoryCount: number;
    searchActive: boolean;
    onExpandAll: () => void;
    onCollapseAll: () => void;
};

export function GroupingControls({
    mode,
    onModeChange,
    prCount,
    repositoryCount,
    searchActive,
    onExpandAll,
    onCollapseAll,
}: GroupingControlsProps) {
    const id = useId();
    return (
        <div className="grouping-controls mb-2 space-y-1 text-sm">
            <div className="flex items-center justify-between gap-2">
                <span
                    className="text-muted-foreground"
                    data-testid="grouping-summary"
                >
                    {prCount} {prCount === 1 ? 'PR' : 'PRs'}
                    {mode === 'repository' &&
                        ` in ${repositoryCount} ${repositoryCount === 1 ? 'repository' : 'repositories'}`}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                    <label htmlFor={id}>View</label>
                    <select
                        id={id}
                        name="pr-grouping"
                        value={mode}
                        onChange={(event) =>
                            onModeChange(
                                event.target
                                    .value as GroupingPreferences['mode']
                            )
                        }
                        className="rounded border border-input bg-background px-2 py-1 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                        <option value="none">All PRs</option>
                        <option value="repository">By repository</option>
                    </select>
                </div>
            </div>
            {mode === 'repository' && (
                <>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="secondary"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            disabled={repositoryCount === 0 || searchActive}
                            onClick={onExpandAll}
                        >
                            Expand all
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            disabled={repositoryCount === 0 || searchActive}
                            onClick={onCollapseAll}
                        >
                            Collapse all
                        </Button>
                    </div>
                    {searchActive && (
                        <p
                            id="grouping-search-explanation"
                            className="w-full text-xs text-muted-foreground"
                        >
                            Matching repositories are expanded while searching.
                            Clear search to collapse them.
                        </p>
                    )}
                </>
            )}
        </div>
    );
}
