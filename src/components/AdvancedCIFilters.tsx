import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { FaChevronDown, FaSlidersH } from 'react-icons/fa';
import { Button } from './ui/button';
import { Card } from './ui/card';
import type { CIStatus } from '../types';

export function AdvancedCIFilters({
    selected,
    onToggle,
}: {
    selected: CIStatus[];
    onToggle: (status: CIStatus) => void;
}) {
    const id = useId();
    const container = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<CSSProperties>({});
    const restricted =
        !selected.includes('no-ci') || !selected.includes('unknown');

    useEffect(() => {
        if (!open) return;
        panel.current?.querySelector('input')?.focus({ preventScroll: true });
        const width = window.innerWidth;
        const height = window.innerHeight;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setOpen(false);
            trigger.current?.focus();
        };
        const onPointerDown = (event: PointerEvent) => {
            if (
                event.target instanceof Node &&
                !container.current?.contains(event.target)
            )
                setOpen(false);
        };
        const onFocusIn = (event: FocusEvent) => {
            if (
                event.target instanceof Node &&
                !container.current?.contains(event.target)
            )
                setOpen(false);
        };
        const onResize = () => {
            if (window.innerWidth === width && window.innerHeight === height)
                return;
            setOpen(false);
        };
        const onScroll = (event: Event) => {
            if (
                event.target instanceof Node &&
                panel.current?.contains(event.target)
            )
                return;
            setOpen(false);
        };
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('focusin', onFocusIn);
        window.addEventListener('resize', onResize);
        document.addEventListener('scroll', onScroll, true);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('focusin', onFocusIn);
            window.removeEventListener('resize', onResize);
            document.removeEventListener('scroll', onScroll, true);
        };
    }, [open]);

    const toggle = () => {
        if (open) {
            setOpen(false);
            return;
        }
        const rect = trigger.current?.getBoundingClientRect();
        if (!rect) return;
        const width = Math.min(176, window.innerWidth - 16);
        const below = window.innerHeight - rect.bottom - 12;
        const above = rect.top - 12;
        const flip = below < 96 && above > below;
        setPosition({
            width,
            left: Math.max(
                8,
                Math.min(rect.right - width, window.innerWidth - width - 8)
            ),
            top: flip ? 'auto' : rect.bottom + 4,
            bottom: flip ? window.innerHeight - rect.top + 4 : 'auto',
            maxHeight: Math.max(0, flip ? above : below),
        });
        setOpen(true);
    };

    return (
        <div ref={container} className="relative shrink-0">
            <Button
                ref={trigger}
                variant="ghost"
                size="sm"
                className="ci-advanced-trigger"
                aria-label="Advanced CI filters"
                aria-haspopup="dialog"
                aria-controls={open ? id : undefined}
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
                onClick={toggle}
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
            {open && (
                <Card
                    ref={panel}
                    id={id}
                    role="dialog"
                    aria-label="Advanced CI filters"
                    className="ci-advanced-dropdown fixed z-50 gap-0 overflow-auto p-1.5 text-[0.8125rem] shadow-lg"
                    style={position}
                >
                    {(['no-ci', 'unknown'] as const).map((status) => (
                        <label
                            key={status}
                            className="flex min-h-[30px] cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-secondary focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-ring"
                        >
                            <input
                                type="checkbox"
                                className="accent-primary"
                                data-ci-status={status}
                                checked={selected.includes(status)}
                                onChange={() => onToggle(status)}
                            />
                            {status === 'no-ci' ? 'No CI' : 'Unknown'}
                        </label>
                    ))}
                </Card>
            )}
        </div>
    );
}
