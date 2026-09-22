import type { FC } from 'react';
import {
    FaClock,
    FaCheck,
    FaTimes,
    FaHourglassHalf,
    FaCodeBranch,
    FaUserCheck,
    FaEyeSlash,
    FaEye,
} from 'react-icons/fa';
import type { PullRequest } from '../types';
import { getAgeColor } from '../utils/dateUtils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

type PullRequestListProps = {
    pullRequests: PullRequest[];
    onToggleHide: (id: number) => void;
};

const formatTimeAgo = (date: string) => {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'just now';
};

export const PullRequestList: FC<PullRequestListProps> = ({
    pullRequests,
    onToggleHide,
}) => {
    return (
        <div className="container mx-auto">
            <ul className="space-y-3">
                {pullRequests.map((pr) => (
                    <li
                        key={pr.id}
                        className={`pr-card-accent overflow-hidden rounded-lg border border-border text-card-foreground transition-shadow hover:shadow-md ${
                            pr.draft ? 'bg-muted' : 'bg-card'
                        } ${
                            pr.ci_status === 'failing'
                                ? 'border-l-ci-failing-foreground'
                                : pr.ci_status === 'pending'
                                  ? 'border-l-ci-pending-foreground'
                                  : pr.ci_status === 'passing'
                                    ? 'border-l-ci-passing-foreground'
                                    : pr.review_status === 'changes-requested'
                                      ? 'border-l-review-changes-foreground'
                                      : pr.review_status === 'approved'
                                        ? 'border-l-review-approved-foreground'
                                        : 'border-l-border'
                        }`}
                    >
                        <a
                            href={pr.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block p-4"
                        >
                            <div className="flex justify-between items-start flex-wrap gap-2 w-full">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2 min-w-0">
                                        <Badge
                                            variant="secondary"
                                            className="max-w-[220px] shrink truncate rounded-md sm:max-w-[280px]"
                                        >
                                            {pr.repository.name}
                                        </Badge>
                                        <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                onToggleHide(pr.id);
                                            }}
                                            className="size-6 text-muted-foreground"
                                            title={
                                                pr.hidden
                                                    ? 'Unhide PR'
                                                    : 'Hide PR'
                                            }
                                            aria-label={
                                                pr.hidden
                                                    ? 'Unhide PR'
                                                    : 'Hide PR'
                                            }
                                        >
                                            {pr.hidden ? (
                                                <FaEyeSlash size={12} />
                                            ) : (
                                                <FaEye size={12} />
                                            )}
                                        </Button>
                                        {/* Age Indicator */}
                                        <div
                                            className={`flex items-center gap-1 text-xs ${getAgeColor(pr.created_at)}`}
                                        >
                                            <FaClock size={12} />
                                            <span>
                                                {formatTimeAgo(pr.created_at)}
                                            </span>
                                        </div>
                                    </div>
                                    <h3 className="mb-1 break-words font-medium whitespace-normal text-card-foreground">
                                        {pr.title}
                                        {pr.draft && (
                                            <Badge
                                                variant="draft"
                                                className="ml-2"
                                            >
                                                Draft
                                            </Badge>
                                        )}
                                    </h3>
                                </div>
                                <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end max-w-full min-w-0">
                                    {/* CI Status Indicator */}
                                    {pr.ci_status && (
                                        <Badge
                                            data-ci-status={pr.ci_status}
                                            variant={
                                                pr.ci_status === 'passing'
                                                    ? 'ciPassing'
                                                    : pr.ci_status === 'failing'
                                                      ? 'ciFailing'
                                                      : 'ciPending'
                                            }
                                        >
                                            <FaCodeBranch
                                                size={12}
                                                className="opacity-80"
                                            />
                                            <span>|</span>
                                            {pr.ci_status === 'passing' ? (
                                                <FaCheck size={12} />
                                            ) : pr.ci_status === 'failing' ? (
                                                <FaTimes size={12} />
                                            ) : (
                                                <FaHourglassHalf size={12} />
                                            )}
                                            <span className="ml-1">
                                                {pr.ci_status
                                                    .charAt(0)
                                                    .toUpperCase() +
                                                    pr.ci_status.slice(1)}
                                            </span>
                                        </Badge>
                                    )}
                                    {/* Review Status */}
                                    {pr.review_status && (
                                        <Badge
                                            data-review-status={
                                                pr.review_status
                                            }
                                            variant={
                                                pr.review_status === 'approved'
                                                    ? 'reviewApproved'
                                                    : pr.review_status ===
                                                        'changes-requested'
                                                      ? 'reviewChanges'
                                                      : 'reviewAwaiting'
                                            }
                                        >
                                            <FaUserCheck
                                                size={12}
                                                className="opacity-80"
                                            />
                                            <span>|</span>
                                            {pr.review_status === 'approved' ? (
                                                <FaCheck size={12} />
                                            ) : pr.review_status ===
                                              'changes-requested' ? (
                                                <FaTimes size={12} />
                                            ) : (
                                                <FaHourglassHalf size={12} />
                                            )}
                                            <span className="ml-1">
                                                {pr.review_status === 'approved'
                                                    ? 'Approved'
                                                    : pr.review_status ===
                                                        'changes-requested'
                                                      ? 'Changes'
                                                      : 'Pending'}
                                            </span>
                                        </Badge>
                                    )}
                                </div>
                            </div>
                            {/* Reviewers Section */}
                            {pr.requested_reviewers.length > 0 && (
                                <div className="mt-3 flex items-center justify-between">
                                    <div className="flex items-center">
                                        <div className="flex -space-x-1 mr-2">
                                            {pr.requested_reviewers
                                                .slice(0, 10)
                                                .map((reviewer) => (
                                                    <img
                                                        key={reviewer.login}
                                                        src={
                                                            reviewer.avatar_url
                                                        }
                                                        alt={reviewer.login}
                                                        className="h-6 w-6 rounded-full border border-card"
                                                        title={reviewer.login}
                                                    />
                                                ))}
                                            {pr.requested_reviewers.length >
                                                10 && (
                                                <div className="flex h-6 w-6 items-center justify-center rounded-full border border-card bg-secondary text-xs font-medium text-secondary-foreground">
                                                    ...
                                                </div>
                                            )}
                                        </div>
                                        <span className="text-xs text-muted-foreground">
                                            {pr.requested_reviewers.length}{' '}
                                            reviewer
                                            {pr.requested_reviewers.length !== 1
                                                ? 's'
                                                : ''}{' '}
                                            requested
                                        </span>
                                    </div>

                                    {/* Author Section */}
                                    {pr.author && (
                                        <div className="flex items-center">
                                            <span className="mr-2 text-xs text-muted-foreground">
                                                Author:
                                            </span>
                                            <img
                                                src={pr.author.avatar_url}
                                                alt={pr.author.login}
                                                className="h-6 w-6 rounded-full border border-card"
                                                title={pr.author.login}
                                            />
                                            <span className="ml-1 text-xs font-medium text-card-foreground">
                                                @{pr.author.login}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Author Section (when no reviewers) */}
                            {pr.requested_reviewers.length === 0 &&
                                pr.author && (
                                    <div className="mt-3 flex justify-end">
                                        <div className="flex items-center">
                                            <span className="mr-2 text-xs text-muted-foreground">
                                                Author:
                                            </span>
                                            <img
                                                src={pr.author.avatar_url}
                                                alt={pr.author.login}
                                                className="h-6 w-6 rounded-full border border-card"
                                                title={pr.author.login}
                                            />
                                            <span className="ml-1 text-xs font-medium text-card-foreground">
                                                @{pr.author.login}
                                            </span>
                                        </div>
                                    </div>
                                )}
                        </a>
                    </li>
                ))}
            </ul>
        </div>
    );
};
