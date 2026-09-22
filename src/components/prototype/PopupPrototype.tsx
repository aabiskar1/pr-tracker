import { useEffect, useRef, useState } from 'react';
import {
    ArrowDownUp,
    Check,
    ChevronDown,
    CircleAlert,
    CircleCheck,
    CircleDashed,
    Clock3,
    ExternalLink,
    GitPullRequest,
    LoaderCircle,
    RefreshCw,
    Search,
    Settings2,
    SlidersHorizontal,
    X,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Separator } from '../ui/separator';
import { Skeleton } from '../ui/skeleton';
import './prototype.css';

type View = 'all' | 'review' | 'authored';
type Ci = 'passing' | 'failing' | 'pending' | 'unavailable';
type Review = 'approved' | 'changes' | 'awaiting' | 'unavailable';
type SamplePr = {
    number: number;
    title: string;
    repo: string;
    age: string;
    author: string;
    reviewer: string;
    ci: Ci;
    review: Review;
    draft?: boolean;
    authored?: boolean;
    yours?: boolean;
};

const samplePrs: SamplePr[] = [
    {
        number: 2481,
        title: 'Fix intermittent failures in the checkout pipeline',
        repo: 'acme / platform',
        age: '2h ago',
        author: 'maria',
        reviewer: 'You',
        ci: 'failing',
        review: 'awaiting',
        yours: true,
    },
    {
        number: 891,
        title: 'Add optimistic updates to the deployment approval flow',
        repo: 'acme / console',
        age: '5h ago',
        author: 'you',
        reviewer: 'ravi',
        ci: 'passing',
        review: 'changes',
        authored: true,
    },
    {
        number: 1340,
        title: 'Simplify session renewal and preserve the original redirect when authentication expires across multiple active organisations',
        repo: 'acme / identity',
        age: '1d ago',
        author: 'nora',
        reviewer: 'You',
        ci: 'pending',
        review: 'awaiting',
        yours: true,
    },
    {
        number: 477,
        title: 'Document the new release checklist',
        repo: 'acme / docs',
        age: '3d ago',
        author: 'you',
        reviewer: 'lee',
        ci: 'passing',
        review: 'approved',
        authored: true,
    },
    {
        number: 912,
        title: 'Explore batched webhook delivery for large installations',
        repo: 'acme / platform',
        age: '9d ago',
        author: 'alex',
        reviewer: 'You',
        ci: 'unavailable',
        review: 'unavailable',
        draft: true,
        yours: true,
    },
];

const status = {
    passing: { label: 'Checks passed', icon: CircleCheck, tone: 'success' },
    failing: { label: 'Checks failing', icon: CircleAlert, tone: 'danger' },
    pending: { label: 'Checks running', icon: CircleDashed, tone: 'warning' },
    unavailable: { label: 'No checks', icon: CircleDashed, tone: 'muted' },
    approved: { label: 'Approved', icon: Check, tone: 'success' },
    changes: { label: 'Changes requested', icon: CircleAlert, tone: 'danger' },
    awaiting: { label: 'Awaiting review', icon: CircleDashed, tone: 'muted' },
} as const;

function Status({ value }: { value: Ci | Review }) {
    const item = status[value];
    const Icon = item.icon;
    return (
        <span
            data-slot="prototype"
            className={`proto-status proto-${item.tone}`}
        >
            <Icon size={13} aria-hidden="true" />
            {item.label}
        </span>
    );
}

function PrRow({ pr }: { pr: SamplePr }) {
    return (
        <li data-slot="prototype" className="proto-row">
            <div data-slot="prototype" className="proto-row-mark">
                <GitPullRequest size={16} aria-hidden="true" />
            </div>
            <div data-slot="prototype" className="proto-row-main">
                <div data-slot="prototype" className="proto-row-heading">
                    <span data-slot="prototype" className="proto-title">
                        {pr.title}
                    </span>
                    {pr.draft && (
                        <span data-slot="prototype" className="proto-draft">
                            Draft
                        </span>
                    )}
                </div>
                <div data-slot="prototype" className="proto-meta">
                    <span data-slot="prototype" className="proto-repo">
                        {pr.repo}
                    </span>
                    <span data-slot="prototype">#{pr.number}</span>
                    <span data-slot="prototype" className="proto-age">
                        <Clock3 size={11} aria-hidden="true" />
                        {pr.age}
                    </span>
                    <span data-slot="prototype" className="proto-owner">
                        {pr.authored ? 'By you' : `By ${pr.author}`} ·{' '}
                        {pr.yours
                            ? 'Review requested'
                            : `Reviewer ${pr.reviewer}`}
                    </span>
                </div>
                <div data-slot="prototype" className="proto-statuses">
                    <Status value={pr.ci} />
                    <span
                        data-slot="prototype"
                        className="proto-status-divider"
                        aria-hidden="true"
                    />
                    <Status value={pr.review} />
                </div>
            </div>
            <ExternalLink className="proto-open" size={14} aria-hidden="true" />
        </li>
    );
}

export function PopupPrototype() {
    const params = new URLSearchParams(window.location.search);
    const fixture = params.get('state');
    const [view, setView] = useState<View>('all');
    const [query, setQuery] = useState('');
    const [filtersOpen, setFiltersOpen] = useState(params.has('filters'));
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [drafts, setDrafts] = useState(true);
    const [ready, setReady] = useState(true);
    const [age, setAge] = useState('all');
    const [ci, setCi] = useState('all');
    const [review, setReview] = useState('all');
    const [sort, setSort] = useState('newest');
    const [customQuery, setCustomQuery] = useState('');
    const [savedQuery, setSavedQuery] = useState('');
    const [syncing, setSyncing] = useState(false);
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement;
            const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(
                target.tagName
            );
            if (
                (event.key === '/' && !editing) ||
                ((event.ctrlKey || event.metaKey) &&
                    event.key.toLowerCase() === 'k')
            ) {
                event.preventDefault();
                searchRef.current?.focus();
            }
            if (
                event.key === 'Escape' &&
                document.activeElement === searchRef.current
            ) {
                searchRef.current?.blur();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const reset = () => {
        setDrafts(true);
        setReady(true);
        setAge('all');
        setCi('all');
        setReview('all');
        setSort('newest');
        setCustomQuery('');
        setSavedQuery('');
    };
    const source = fixture === 'empty' ? [] : samplePrs;
    const visible = source.filter((pr) => {
        if (view === 'review' && !pr.yours) return false;
        if (view === 'authored' && !pr.authored) return false;
        if (!drafts && pr.draft) return false;
        if (!ready && !pr.draft) return false;
        if (ci !== 'all' && pr.ci !== ci) return false;
        if (review !== 'all' && pr.review !== review) return false;
        if (age === 'today' && !['2h ago', '5h ago'].includes(pr.age))
            return false;
        if (age === 'week' && pr.age === '9d ago') return false;
        if (age === 'older' && pr.age !== '9d ago') return false;
        return `${pr.title} ${pr.repo} ${pr.author} ${pr.number}`
            .toLowerCase()
            .includes(query.toLowerCase());
    });
    const ordered =
        sort === 'oldest' || sort === 'most-stale'
            ? [...visible].reverse()
            : visible;
    const activeFilters =
        !drafts ||
        !ready ||
        age !== 'all' ||
        ci !== 'all' ||
        review !== 'all' ||
        Boolean(savedQuery);

    return (
        <main
            data-slot="prototype"
            data-testid="popup-prototype"
            className="pr-prototype"
        >
            <header data-slot="prototype" className="proto-header">
                <div data-slot="prototype" className="proto-brand">
                    <div data-slot="prototype" className="proto-logo">
                        <GitPullRequest
                            size={17}
                            strokeWidth={2.25}
                            aria-hidden="true"
                        />
                    </div>
                    <span data-slot="prototype">
                        PR <strong>Tracker</strong>
                    </span>
                    <span data-slot="prototype" className="proto-brand-caption">
                        YOUR WORK QUEUE
                    </span>
                </div>
                <div data-slot="prototype" className="proto-header-actions">
                    <span data-slot="prototype" className="proto-sync">
                        <span
                            data-slot="prototype"
                            className="proto-sync-dot"
                        />
                        {syncing ? 'Syncing' : 'Updated just now'}
                    </span>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Refresh pull requests"
                        onClick={() => {
                            setSyncing(true);
                            window.setTimeout(() => setSyncing(false), 800);
                        }}
                    >
                        <RefreshCw
                            size={15}
                            className={syncing ? 'proto-spinning' : ''}
                        />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Open settings"
                        aria-expanded={settingsOpen}
                        onClick={() => setSettingsOpen(!settingsOpen)}
                    >
                        <Settings2 size={16} />
                    </Button>
                </div>
            </header>

            {settingsOpen ? (
                <section
                    data-slot="prototype"
                    className="proto-settings"
                    aria-label="Settings preview"
                >
                    <div
                        data-slot="prototype"
                        className="proto-section-heading"
                    >
                        <span data-slot="prototype">Settings preview</span>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Close settings"
                            onClick={() => setSettingsOpen(false)}
                        >
                            <X size={16} />
                        </Button>
                    </div>
                    <p data-slot="prototype">
                        Account, notifications, appearance and sign-out live
                        here in the proposed layout. This design fixture does
                        not change preferences.
                    </p>
                    <div data-slot="prototype" className="proto-setting-row">
                        <span data-slot="prototype">Appearance</span>
                        <span data-slot="prototype">Light · Dark · System</span>
                    </div>
                    <div data-slot="prototype" className="proto-setting-row">
                        <span data-slot="prototype">Notifications</span>
                        <span data-slot="prototype">On</span>
                    </div>
                    <div data-slot="prototype" className="proto-setting-row">
                        <span data-slot="prototype">Account</span>
                        <span data-slot="prototype">@you</span>
                    </div>
                </section>
            ) : (
                <>
                    <section
                        data-slot="prototype"
                        className="proto-command"
                        aria-label="Search and navigation"
                    >
                        <div
                            data-slot="prototype"
                            className="proto-search-wrap"
                        >
                            <Search size={17} aria-hidden="true" />
                            <Input
                                ref={searchRef}
                                value={query}
                                onChange={(event) =>
                                    setQuery(event.target.value)
                                }
                                placeholder="Search pull requests, repositories, people…"
                                aria-label="Search pull requests"
                            />
                            {query ? (
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Clear search"
                                    onClick={() => setQuery('')}
                                >
                                    <X size={14} />
                                </Button>
                            ) : (
                                <kbd data-slot="prototype">/</kbd>
                            )}
                        </div>
                        <div data-slot="prototype" className="proto-nav-line">
                            <nav
                                data-slot="prototype"
                                className="proto-nav"
                                aria-label="Pull request views"
                            >
                                {(
                                    [
                                        ['all', 'All', 5],
                                        ['review', 'For review', 3],
                                        ['authored', 'Created by me', 2],
                                    ] as const
                                ).map(([id, label, count]) => (
                                    <button
                                        data-slot="button"
                                        key={id}
                                        type="button"
                                        className={
                                            view === id
                                                ? 'proto-tab active'
                                                : 'proto-tab'
                                        }
                                        aria-current={
                                            view === id ? 'page' : undefined
                                        }
                                        onClick={() => setView(id)}
                                    >
                                        {label}
                                        <span
                                            data-slot="prototype"
                                            className="proto-count"
                                        >
                                            {count}
                                        </span>
                                    </button>
                                ))}
                            </nav>
                            <Button
                                variant="outline"
                                size="sm"
                                className="proto-filter-button"
                                aria-expanded={filtersOpen}
                                aria-controls="proto-filters"
                                onClick={() => setFiltersOpen(!filtersOpen)}
                            >
                                <SlidersHorizontal size={14} />
                                Filters
                                {activeFilters && (
                                    <span
                                        data-slot="prototype"
                                        className="proto-active-dot"
                                    />
                                )}
                                <ChevronDown
                                    size={13}
                                    className={
                                        filtersOpen ? 'proto-chevron-open' : ''
                                    }
                                />
                            </Button>
                        </div>
                    </section>

                    {filtersOpen && (
                        <section
                            data-slot="prototype"
                            id="proto-filters"
                            className="proto-filters"
                            aria-label="Advanced filters"
                        >
                            <div
                                data-slot="prototype"
                                className="proto-filter-heading"
                            >
                                <span data-slot="prototype">
                                    REFINE YOUR QUEUE
                                </span>
                                <button
                                    data-slot="button"
                                    type="button"
                                    onClick={reset}
                                >
                                    Reset all
                                </button>
                            </div>
                            <div
                                data-slot="prototype"
                                className="proto-filter-grid"
                            >
                                <fieldset
                                    data-slot="prototype"
                                    className="proto-checks"
                                >
                                    <legend>State</legend>
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={ready}
                                            onChange={(event) =>
                                                setReady(event.target.checked)
                                            }
                                        />{' '}
                                        Ready
                                    </label>
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={drafts}
                                            onChange={(event) =>
                                                setDrafts(event.target.checked)
                                            }
                                        />{' '}
                                        Draft
                                    </label>
                                </fieldset>
                                <label data-slot="prototype">
                                    Age
                                    <select
                                        value={age}
                                        onChange={(event) =>
                                            setAge(event.target.value)
                                        }
                                    >
                                        <option value="all">Any time</option>
                                        <option value="today">Today</option>
                                        <option value="week">This week</option>
                                        <option value="older">Older</option>
                                    </select>
                                </label>
                                <label data-slot="prototype">
                                    CI
                                    <select
                                        value={ci}
                                        onChange={(event) =>
                                            setCi(event.target.value)
                                        }
                                    >
                                        <option value="all">Any status</option>
                                        <option value="passing">Passing</option>
                                        <option value="failing">Failing</option>
                                        <option value="pending">Pending</option>
                                    </select>
                                </label>
                                <label data-slot="prototype">
                                    Review
                                    <select
                                        value={review}
                                        onChange={(event) =>
                                            setReview(event.target.value)
                                        }
                                    >
                                        <option value="all">Any status</option>
                                        <option value="approved">
                                            Approved
                                        </option>
                                        <option value="changes">
                                            Changes requested
                                        </option>
                                        <option value="awaiting">
                                            Awaiting review
                                        </option>
                                    </select>
                                </label>
                            </div>
                            <div
                                data-slot="prototype"
                                className="proto-filter-bottom"
                            >
                                <label
                                    data-slot="prototype"
                                    className="proto-query-label"
                                >
                                    Custom GitHub query
                                    <Input
                                        value={customQuery}
                                        onChange={(event) =>
                                            setCustomQuery(event.target.value)
                                        }
                                        placeholder="is:open is:pr org:acme"
                                        aria-label="Custom GitHub query"
                                    />
                                </label>
                                <Button
                                    size="sm"
                                    disabled={
                                        !customQuery.trim() ||
                                        customQuery === savedQuery
                                    }
                                    onClick={() => setSavedQuery(customQuery)}
                                >
                                    Apply query
                                </Button>
                            </div>
                            {savedQuery && (
                                <span
                                    data-slot="prototype"
                                    className="proto-query-note"
                                >
                                    Preview only · Query: {savedQuery}
                                </span>
                            )}
                        </section>
                    )}

                    <section
                        data-slot="prototype"
                        className="proto-results"
                        aria-label="Pull requests"
                    >
                        <div
                            data-slot="prototype"
                            className="proto-list-heading"
                        >
                            <div data-slot="prototype">
                                <span
                                    data-slot="prototype"
                                    className="proto-list-title"
                                >
                                    {view === 'all'
                                        ? 'All pull requests'
                                        : view === 'review'
                                          ? 'Awaiting your review'
                                          : 'Created by you'}
                                </span>
                                <span
                                    data-slot="prototype"
                                    className="proto-result-count"
                                >
                                    {fixture === 'loading'
                                        ? '—'
                                        : ordered.length}
                                </span>
                            </div>
                            <label data-slot="prototype" className="proto-sort">
                                <ArrowDownUp size={13} />
                                <span data-slot="prototype">Sort</span>
                                <select
                                    aria-label="Sort pull requests"
                                    value={sort}
                                    onChange={(event) =>
                                        setSort(event.target.value)
                                    }
                                >
                                    <option value="newest">Newest first</option>
                                    <option value="oldest">Oldest first</option>
                                    <option value="urgent">
                                        Most reviewers
                                    </option>
                                    <option value="most-stale">
                                        Most stale
                                    </option>
                                </select>
                            </label>
                        </div>
                        <Separator />
                        {fixture === 'loading' ? (
                            <div
                                data-slot="prototype"
                                className="proto-loading"
                                aria-label="Loading pull requests"
                            >
                                <LoaderCircle
                                    size={16}
                                    className="proto-spinning"
                                />
                                <span data-slot="prototype">
                                    Refreshing your queue…
                                </span>
                                {[1, 2, 3].map((item) => (
                                    <div
                                        data-slot="prototype"
                                        className="proto-skeleton-row"
                                        key={item}
                                    >
                                        <Skeleton className="proto-skeleton-title" />
                                        <Skeleton className="proto-skeleton-meta" />
                                    </div>
                                ))}
                            </div>
                        ) : ordered.length ? (
                            <ul data-slot="prototype" className="proto-list">
                                {ordered.map((pr) => (
                                    <PrRow key={pr.number} pr={pr} />
                                ))}
                            </ul>
                        ) : (
                            <div data-slot="prototype" className="proto-empty">
                                <CircleCheck size={27} aria-hidden="true" />
                                <strong>No pull requests here</strong>
                                <span data-slot="prototype">
                                    Try another view or reset your filters.
                                </span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        setQuery('');
                                        setView('all');
                                        reset();
                                    }}
                                >
                                    Reset filters
                                </Button>
                            </div>
                        )}
                    </section>
                </>
            )}
            <footer data-slot="prototype" className="proto-footer">
                <span data-slot="prototype">
                    <span data-slot="prototype" className="proto-footer-dot" />
                    {fixture === 'loading'
                        ? 'Checking for updates'
                        : 'All changes synced'}
                </span>
                <span data-slot="prototype">
                    Press <kbd>/</kbd> to search
                </span>
            </footer>
        </main>
    );
}
