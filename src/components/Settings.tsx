import { useEffect, useId, useRef, useState } from 'react';
import { FaCog } from 'react-icons/fa';
import type { ThemePreference } from '../types';
import ThemeSwitcher from './ThemeSwitcher';
import { Button } from './ui/button';
import { Card } from './ui/card';

export function Settings({
    theme,
    onThemeChange,
    notificationsEnabled,
    onToggleNotifications,
}: {
    theme: ThemePreference;
    onThemeChange: (theme: ThemePreference) => void;
    notificationsEnabled: boolean;
    onToggleNotifications: () => void;
}) {
    const [open, setOpen] = useState(false);
    const panelId = useId();
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        panelRef.current?.querySelector('select')?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setOpen(false);
                triggerRef.current?.focus();
            }
        };
        const onPointerDown = (event: PointerEvent) => {
            if (
                event.target instanceof Node &&
                !containerRef.current?.contains(event.target)
            ) {
                setOpen(false);
            }
        };
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('pointerdown', onPointerDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('pointerdown', onPointerDown);
        };
    }, [open]);

    return (
        <div
            ref={containerRef}
            className="relative shrink-0"
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                    setOpen(false);
            }}
        >
            <Button
                ref={triggerRef}
                variant="secondary"
                size="sm"
                className="h-[22px] gap-1.5"
                aria-label="Settings"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? panelId : undefined}
                onClick={() => setOpen((current) => !current)}
            >
                <FaCog aria-hidden="true" />
                Settings
            </Button>
            {open && (
                <Card
                    ref={panelRef}
                    id={panelId}
                    role="dialog"
                    aria-label="Settings"
                    className="absolute right-0 top-full z-50 mt-2 w-60 gap-3 p-3 shadow-lg"
                >
                    <h3 className="text-sm font-semibold">Settings</h3>
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-sm">Theme</span>
                        <ThemeSwitcher
                            theme={theme}
                            onThemeChange={onThemeChange}
                        />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-sm">Notifications</span>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                role="switch"
                                aria-checked={notificationsEnabled}
                                aria-label={
                                    notificationsEnabled
                                        ? 'Disable notifications'
                                        : 'Enable notifications'
                                }
                                onClick={onToggleNotifications}
                                className="theme-toggle-switch relative inline-flex h-6 items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                data-enabled={
                                    notificationsEnabled ? 'true' : 'false'
                                }
                            >
                                <span className="toggle-track h-6 w-11 rounded-full transition-colors" />
                                <span
                                    className={`toggle-thumb absolute left-0.5 top-0.5 h-5 w-5 rounded-full transition-transform ${notificationsEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                                />
                            </button>
                            <span className="text-sm text-muted-foreground">
                                {notificationsEnabled ? 'On' : 'Off'}
                            </span>
                        </div>
                    </div>
                </Card>
            )}
        </div>
    );
}
