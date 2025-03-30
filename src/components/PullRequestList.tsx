import { FC } from 'react';
import { FaClock, FaCheck, FaTimes, FaHourglassHalf } from 'react-icons/fa';
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
};

type PullRequestListProps = {
  pullRequests: PullRequest[];
}

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
    <div className="container mx-auto px-4">
      <ul className="space-y-3">
        {pullRequests.map((pr) => (
          <li 
            key={pr.id} 
            className={`rounded-lg border dark:border-gray-700 hover:shadow-md transition-shadow ${
              pr.draft ? 'bg-gray-50 dark:bg-gray-900/30' : 'bg-white dark:bg-gray-700'
            }`}
          >
            <a 
              href={pr.html_url}
              target="_blank" 
              rel="noopener noreferrer"
              className="block p-4"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-block px-2 py-1 text-xs font-medium rounded bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300">
                      {pr.repository.name}
                    </span>
                    
                    {/* Age Indicator */}
                    <div className={`flex items-center gap-1 text-xs ${getAgeColor(pr.created_at)}`}>
                      <FaClock size={12} />
                      <span>{formatTimeAgo(pr.created_at)}</span>
                    </div>
                  </div>
                  
                  <h3 className="font-medium text-gray-800 dark:text-white mb-1">
                    {pr.title}
                    {pr.draft && (
                      <span className="ml-2 px-2 py-0.5 text-xs rounded bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300">
                        Draft
                      </span>
                    )}
                  </h3>
                </div>
                
                <div className="flex items-center gap-3">
                  {/* CI Status Indicator */}
                  {pr.ci_status && (
                    <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
                      pr.ci_status === 'passing' 
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        : pr.ci_status === 'failing'
                        ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                        : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                    }`}>
                      {pr.ci_status === 'passing' ? (
                        <FaCheck size={12} />
                      ) : pr.ci_status === 'failing' ? (
                        <FaTimes size={12} />
                      ) : (
                        <FaHourglassHalf size={12} />
                      )}
                      <span>{pr.ci_status.charAt(0).toUpperCase() + pr.ci_status.slice(1)}</span>
                    </div>
                  )}
                  
                  {/* Review Status */}
                  {pr.review_status && (
                    <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
                      pr.review_status === 'approved'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        : pr.review_status === 'changes-requested'
                        ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                        : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                    }`}>
                      {pr.review_status === 'approved' ? (
                        <FaCheck size={12} />
                      ) : pr.review_status === 'changes-requested' ? (
                        <FaTimes size={12} />
                      ) : (
                        <FaHourglassHalf size={12} />
                      )}
                      <span>
                        {pr.review_status === 'approved' 
                          ? 'Approved' 
                          : pr.review_status === 'changes-requested' 
                          ? 'Changes' 
                          : 'Pending'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Reviewers Section */}
              {pr.requested_reviewers.length > 0 && (
                <div className="mt-3 flex items-center">
                  <div className="flex -space-x-1 mr-2">
                    {pr.requested_reviewers.map(reviewer => (
                      <img
                        key={reviewer.login}
                        src={reviewer.avatar_url}
                        alt={reviewer.login}
                        className="w-6 h-6 rounded-full border border-white dark:border-gray-800"
                        title={reviewer.login}
                      />
                    ))}
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {pr.requested_reviewers.length} reviewer{pr.requested_reviewers.length !== 1 ? 's' : ''} requested
                  </span>
                </div>
              )}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};