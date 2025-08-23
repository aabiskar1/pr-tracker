import { FC } from 'react';
import {
    FaClock,
    FaCheck,
    FaTimes,
    FaHourglassHalf,
    FaCodeBranch,
    FaUserCheck,
} from 'react-icons/fa';
import { getAgeColor } from './FilterBar';
import { ReviewStatus, CIStatus } from './FilterBar';

type PullRequest = {
    id: number;
    title: string;
    html_url: string;
    repository: {
        name: string;
    };
    state: string;
    draft: boolean;
    created_at: string;
    requested_reviewers: { login: string; avatar_url: string }[];
    review_status?: ReviewStatus;
    ci_status?: CIStatus;
    author?: { login: string; avatar_url: string };
};

type PullRequestListProps = {
    pullRequests: PullRequest[];
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

export const PullRequestList: FC<PullRequestListProps> = ({ pullRequests }) => {
    return (
        <div className="container mx-auto">
            <ul className="space-y-3">
                {pullRequests.map((pr) => (
                                        <li
                                            key={pr.id}
                                            className={`rounded-lg border pr-card-accent dark:border-gray-700 hover:shadow-md transition-shadow overflow-hidden ${
                            pr.draft
                                ? 'bg-gray-50 dark:bg-gray-900/30'
                                : 'bg-white dark:bg-gray-700'
                                                } ${
                                                        pr.ci_status === 'failing'
                                                                ? 'border-l-red-500'
                                                                : pr.ci_status === 'pending'
                                                                    ? 'border-l-yellow-500'
                                                                    : pr.ci_status === 'passing'
                                                                        ? 'border-l-green-500'
                                                                        : pr.review_status === 'changes-requested'
                                                                            ? 'border-l-red-500'
                                                                            : pr.review_status === 'approved'
                                                                                ? 'border-l-green-500'
                                                                                : 'border-l-gray-300 dark:border-l-gray-600'
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
                                        <span className="inline-block px-2 py-1 text-xs font-medium rounded badge-repo max-w-[220px] sm:max-w-[280px] truncate align-middle shrink">
                                            {pr.repository.name}
                                        </span>
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
                                    <h3 className="font-medium text-gray-800 dark:text-white mb-1 break-words whitespace-normal">
                                        {pr.title}
                                        {pr.draft && (
                                            <span className="ml-2 px-2 py-0.5 text-xs rounded badge-draft">
                                                Draft
                                            </span>
                                        )}
                                    </h3>
                                </div>
                                <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end max-w-full min-w-0">
                                    {/* CI Status Indicator */}
                                    {pr.ci_status && (
                                        <div
                                            className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
                                                pr.ci_status === 'passing'
                                                    ? 'badge-passing'
                                                    : pr.ci_status === 'failing'
                                                      ? 'badge-failing'
                                                      : 'badge-pending'
                                            }`}
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
                                        </div>
                                    )}
                                    {/* Review Status */}
                                    {pr.review_status && (
                                        <div
                                            className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
                                                pr.review_status === 'approved'
                                                    ? 'badge-approved'
                                                    : pr.review_status ===
                                                        'changes-requested'
                                                      ? 'badge-changes'
                                                      : 'badge-pending'
                                            }`}
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
                                        </div>
                                    )}
                                </div>
                            </div>
                            {/* Reviewers Section */}
                            {pr.requested_reviewers.length > 0 && (
                                <div className="mt-3 flex items-center justify-between">
                                    <div className="flex items-center">
                                        <div className="flex -space-x-1 mr-2">
                                            {pr.requested_reviewers.slice(0, 10).map(
                                                (reviewer) => (
                                                    <img
                                                        key={reviewer.login}
                                                        src={reviewer.avatar_url}
                                                        alt={reviewer.login}
                                                        className="w-6 h-6 rounded-full border border-white dark:border-gray-800"
                                                        title={reviewer.login}
                                                    />
                                                )
                                            )}
                                            {pr.requested_reviewers.length > 10 && (
                                                <div className="w-6 h-6 rounded-full border border-white dark:border-gray-800 bg-gray-200 dark:bg-gray-600 flex items-center justify-center text-xs text-gray-600 dark:text-gray-300 font-medium">
                                                    ...
                                                </div>
                                            )}
                                        </div>
                                        <span className="text-xs text-gray-500 dark:text-gray-400">
                                            {pr.requested_reviewers.length} reviewer
                                            {pr.requested_reviewers.length !== 1
                                                ? 's'
                                                : ''}{' '}
                                            requested
                                        </span>
                                    </div>
                                    
                                    {/* Author Section */}
                                    {pr.author && (
                                        <div className="flex items-center">
                                            <span className="text-xs text-gray-500 dark:text-gray-400 mr-2">
                                                Author: 
                                            </span>
                                            <img
                                                src={pr.author.avatar_url}
                                                alt={pr.author.login}
                                                className="w-6 h-6 rounded-full border border-white dark:border-gray-800"
                                                title={pr.author.login}
                                            />
                                            <span className="text-xs text-gray-600 dark:text-gray-300 ml-1 font-medium">
                                                @{pr.author.login}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Author Section (when no reviewers) */}
                            {pr.requested_reviewers.length === 0 && pr.author && (
                                <div className="mt-3 flex justify-end">
                                    <div className="flex items-center">
                                        <span className="text-xs text-gray-500 dark:text-gray-400 mr-2">
                                            Author: 
                                        </span>
                                        <img
                                            src={pr.author.avatar_url}
                                            alt={pr.author.login}
                                            className="w-6 h-6 rounded-full border border-white dark:border-gray-800"
                                            title={pr.author.login}
                                        />
                                        <span className="text-xs text-gray-600 dark:text-gray-300 ml-1 font-medium">
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
