import { useEffect, useId, useRef, useState } from 'react';
import { FaChevronDown, FaSlidersH } from 'react-icons/fa';
import { Button } from './ui/button';
import type { CIStatus } from '../types';

export function AdvancedCIFilters({
    selected,
    onToggle,
}: {
    selected: CIStatus[];
    onToggle: (status: CIStatus) => void;
}) {
    const id = useId();
    const trigger = useRef<HTMLButtonElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const restricted =
        !selected.includes('no-ci') || !selected.includes('unknown');

    useEffect(() => {
        if (!open) return;
        // Dismiss rather than leave a floating menu detached from its trigger.
        const dismiss = (event: Event) => {
            if (
                event.target instanceof Node &&
                menu.current?.contains(event.target)
            )
                return;
            menu.current?.hidePopover();
        };
        window.addEventListener('resize', dismiss);
        document.addEventListener('scroll', dismiss, true);
        return () => {
            window.removeEventListener('resize', dismiss);
            document.removeEventListener('scroll', dismiss, true);
        };
    }, [open]);

    return (
        <>
            <Button
                ref={trigger}
                variant="ghost"
                size="sm"
                className="ci-advanced-trigger"
                popoverTarget={id}
                aria-label="Advanced CI filters"
                aria-controls={id}
                aria-expanded={open}
                aria-describedby={`${id}-summary`}
                data-filtered={restricted}
                title={
                    selected.length === 0
                        ? 'All CI states included (no selection)'
                        : restricted
                          ? 'Some advanced CI states are excluded'
                          : 'Advanced CI filters'
                }
            >
                <FaSlidersH size={11} aria-hidden="true" />
                Advanced
                {restricted && (
                    <span
                        className="ci-advanced-indicator"
                        aria-hidden="true"
                    />
                )}
                <FaChevronDown size={9} aria-hidden="true" />
            </Button>
            <span id={`${id}-summary`} className="sr-only">
                {selected.length === 0
                    ? 'All CI states included (no selection)'
                    : restricted
                      ? 'Some advanced CI states are excluded'
                      : 'Both advanced CI states are included'}
            </span>
            <div
                ref={menu}
                id={id}
                popover="auto"
                role="group"
                aria-label="Advanced CI filters"
                className="ci-advanced-popover"
                onBeforeToggle={(event) => {
                    if (event.newState !== 'open' || !trigger.current) return;
                    const rect = trigger.current.getBoundingClientRect();
                    const panel = event.currentTarget;
                    const width = Math.min(176, window.innerWidth - 16);
                    const below = window.innerHeight - rect.bottom - 12;
                    const above = rect.top - 12;
                    const flip = below < 96 && above > below;
                    panel.style.width = `${width}px`;
                    panel.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
                    panel.style.top = flip ? 'auto' : `${rect.bottom + 4}px`;
                    panel.style.bottom = flip
                        ? `${window.innerHeight - rect.top + 4}px`
                        : 'auto';
                    panel.style.maxHeight = `${Math.max(0, flip ? above : below)}px`;
                }}
                onToggle={(event) => {
                    const visible = event.newState === 'open';
                    setOpen(visible);
                    if (visible)
                        event.currentTarget
                            .querySelector<HTMLInputElement>('input')
                            ?.focus({ preventScroll: true });
                }}
                onBlur={(event) => {
                    if (
                        event.relatedTarget &&
                        !event.currentTarget.contains(event.relatedTarget) &&
                        event.relatedTarget !== trigger.current
                    )
                        event.currentTarget.hidePopover();
                }}
            >
                {(['no-ci', 'unknown'] as const).map((status) => (
                    <label key={status}>
                        <input
                            type="checkbox"
                            data-ci-status={status}
                            checked={selected.includes(status)}
                            onChange={() => onToggle(status)}
                        />
                        {status === 'no-ci' ? 'No CI' : 'Unknown'}
                    </label>
                ))}
            </div>
        </>
    );
}
