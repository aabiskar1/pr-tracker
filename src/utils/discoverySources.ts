import type { PullRequest } from '../types';

// Unknown/legacy and custom-query snapshots keep their previous visibility
// and notification behaviour. Aggregate review_status is unrelated to identity.
export function isReviewedOnly(pr: PullRequest): boolean {
    return (
        pr.discoverySources?.includes('reviewed') === true &&
        !pr.discoverySources.includes('authored') &&
        !pr.discoverySources.includes('review-requested')
    );
}
