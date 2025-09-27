// PR Tracker Test Data Injection Module with Authors and More Reviewers
// Parameterized password for flexible testing

// Test data injection function with configurable password
export async function injectTestData(password: string = '12345678') {
    // Pool of test users for authors and reviewers
    const testUsers = [
        {
            login: 'alice',
            avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
        },
        {
            login: 'bob',
            avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4',
        },
        {
            login: 'carol',
            avatar_url: 'https://avatars.githubusercontent.com/u/3?v=4',
        },
        {
            login: 'dave',
            avatar_url: 'https://avatars.githubusercontent.com/u/4?v=4',
        },
        {
            login: 'eve',
            avatar_url: 'https://avatars.githubusercontent.com/u/5?v=4',
        },
        {
            login: 'frank',
            avatar_url: 'https://avatars.githubusercontent.com/u/6?v=4',
        },
        {
            login: 'grace',
            avatar_url: 'https://avatars.githubusercontent.com/u/7?v=4',
        },
        {
            login: 'henry',
            avatar_url: 'https://avatars.githubusercontent.com/u/8?v=4',
        },
        {
            login: 'iris',
            avatar_url: 'https://avatars.githubusercontent.com/u/9?v=4',
        },
        {
            login: 'jack',
            avatar_url: 'https://avatars.githubusercontent.com/u/10?v=4',
        },
        {
            login: 'kate',
            avatar_url: 'https://avatars.githubusercontent.com/u/11?v=4',
        },
        {
            login: 'luke',
            avatar_url: 'https://avatars.githubusercontent.com/u/12?v=4',
        },
        {
            login: 'mary',
            avatar_url: 'https://avatars.githubusercontent.com/u/13?v=4',
        },
        {
            login: 'noah',
            avatar_url: 'https://avatars.githubusercontent.com/u/14?v=4',
        },
        {
            login: 'olivia',
            avatar_url: 'https://avatars.githubusercontent.com/u/15?v=4',
        },
    ];

    // Helper function to get random users for reviewers
    const getRandomReviewers = (
        count: number,
        excludeAuthor: string | null = null
    ) => {
        const availableUsers = testUsers.filter(
            (user) => user.login !== excludeAuthor
        );
        const shuffled = [...availableUsers].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
    };

    // Test pull request data with authors and multiple reviewers
    const testPRs = [
        {
            id: 1,
            title: 'Add new authentication flow',
            html_url: 'https://github.com/acme/auth-service/pull/1',
            repository: { name: 'auth-service' },
            state: 'open',
            draft: false,
            created_at: new Date(
                Date.now() - 2 * 24 * 60 * 60 * 1000
            ).toISOString(),
            author: testUsers[0], // alice
            requested_reviewers: getRandomReviewers(8, 'alice'), // 8 reviewers excluding author
            review_status: 'pending',
            ci_status: 'passing',
        },
        {
            id: 2,
            title: 'Fix bug in dashboard components',
            html_url: 'https://github.com/acme/web-dashboard/pull/2',
            repository: { name: 'web-dashboard' },
            state: 'open',
            draft: true,
            created_at: new Date(
                Date.now() - 5 * 24 * 60 * 60 * 1000
            ).toISOString(),
            author: testUsers[1], // bob
            requested_reviewers: getRandomReviewers(12, 'bob'), // 12 reviewers to test the "..." display
            review_status: 'approved',
            ci_status: 'failing',
        },
        {
            id: 3,
            title: 'Refactor API layer for better performance',
            html_url: 'https://github.com/acme/api-gateway/pull/3',
            repository: { name: 'api-gateway' },
            state: 'open',
            draft: false,
            created_at: new Date(
                Date.now() - 1 * 24 * 60 * 60 * 1000
            ).toISOString(),
            author: testUsers[2], // carol
            requested_reviewers: getRandomReviewers(10, 'carol'), // exactly 10 reviewers
            review_status: 'changes-requested',
            ci_status: 'pending',
        },
        {
            id: 4,
            title: 'Update README and documentation',
            html_url: 'https://github.com/acme/docs/pull/4',
            repository: { name: 'docs' },
            state: 'open',
            draft: false,
            created_at: new Date(
                Date.now() - 10 * 24 * 60 * 60 * 1000
            ).toISOString(),
            author: testUsers[3], // dave
            requested_reviewers: [], // No reviewers to test author-only display
            review_status: 'approved',
            ci_status: 'passing',
        },
        {
            id: 5,
            title: 'WIP: Add dark mode support to UI components',
            html_url: 'https://github.com/acme/ui-library/pull/5',
            repository: { name: 'ui-library' },
            state: 'open',
            draft: true,
            created_at: new Date(
                Date.now() - 3 * 24 * 60 * 60 * 1000
            ).toISOString(),
            author: testUsers[4], // eve
            requested_reviewers: getRandomReviewers(6, 'eve'), // 6 reviewers
            review_status: 'pending',
            ci_status: 'pending',
        },
        {
            id: 6,
            title: 'Hotfix: Critical security vulnerability patch',
            html_url: 'https://github.com/acme/auth-service/pull/6',
            repository: { name: 'auth-service' },
            state: 'open',
            draft: false,
            created_at: new Date(
                Date.now() - 0.5 * 24 * 60 * 60 * 1000
            ).toISOString(),
            author: testUsers[5], // frank
            requested_reviewers: getRandomReviewers(9, 'frank'), // 9 reviewers for critical fix
            review_status: 'approved',
            ci_status: 'passing',
        },
        {
            id: 7,
            title: 'Remove deprecated API endpoints',
            html_url: 'https://github.com/acme/api-gateway/pull/7',
            repository: { name: 'api-gateway' },
            state: 'open',
            draft: false,
            created_at: new Date(
                Date.now() - 15 * 24 * 60 * 60 * 1000
            ).toISOString(),
            author: testUsers[6], // grace
            requested_reviewers: getRandomReviewers(4, 'grace'), // 4 reviewers
            review_status: 'changes-requested',
            ci_status: 'failing',
        },
    ];

    try {
        console.log('🧹 Clearing existing data...');

        // Clear all storage keys related to PR Tracker
        const keysToRemove = [
            'pullRequests',
            'oldPullRequests',
            'prtracker-notifications-enabled',
            'prtracker-custom-query',
            'prtracker-filters',
            'prtracker-sort',
            'encryptedAppData',
            'appDataIv',
            'encryptedGithubToken',
            'prtracker_iv',
            'prtracker_salt',
            'encryptionTestVector',
        ];

        await chrome.storage.local.remove(keysToRemove);
        console.log('✅ Existing data cleared');

        // Helper function to generate IV
        function generateIV() {
            return crypto.getRandomValues(new Uint8Array(12));
        }

        // Helper function to derive encryption key
        async function getEncryptionKey(userPassword: string) {
            // Generate or get salt
            const saltArray = crypto.getRandomValues(new Uint8Array(16));
            await chrome.storage.local.set({
                prtracker_salt: Array.from(saltArray),
            });

            // Get extension ID
            const extensionInfo = await chrome.management.getSelf();
            const browserKey = extensionInfo.id;
            const combinedKey = browserKey + ':' + userPassword;

            // Convert to bytes
            const encoder = new TextEncoder();
            const keyData = encoder.encode(combinedKey);

            // Import key material
            const keyMaterial = await crypto.subtle.importKey(
                'raw',
                keyData,
                { name: 'PBKDF2' },
                false,
                ['deriveBits', 'deriveKey']
            );

            // Derive encryption key
            return crypto.subtle.deriveKey(
                {
                    name: 'PBKDF2',
                    salt: saltArray,
                    iterations: 100000,
                    hash: 'SHA-256',
                },
                keyMaterial,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt', 'decrypt']
            );
        }

        // Setup encryption test vector
        async function setupEncryption() {
            const key = await getEncryptionKey(password);
            const iv = generateIV();
            const testValue = 'PR_TRACKER_VALID';
            const encoder = new TextEncoder();
            const testData = encoder.encode(testValue);

            const encryptedData = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                testData
            );

            const encryptedArray = Array.from(new Uint8Array(encryptedData));
            const ivArray = Array.from(iv);

            await chrome.storage.local.set({
                encryptionTestVector: {
                    data: encryptedArray,
                    iv: ivArray,
                },
            });
        }

        // Encrypt and store app data
        async function encryptAppData(data: any) {
            const key = await getEncryptionKey(password);
            const iv = generateIV();
            const dataString = JSON.stringify(data);
            const encoder = new TextEncoder();
            const dataBytes = encoder.encode(dataString);

            const encryptedData = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                dataBytes
            );

            const encryptedArray = Array.from(new Uint8Array(encryptedData));
            const ivArray = Array.from(iv);

            await chrome.storage.local.set({
                encryptedAppData: encryptedArray,
                appDataIv: ivArray,
            });
        }

        console.log('🔐 Setting up encryption...');
        await setupEncryption();

        console.log('💾 Injecting test data...');

        // Create app data structure
        const appData = {
            pullRequests: testPRs,
            lastUpdated: new Date().toISOString(),
            preferences: {
                notificationsEnabled: true,
                customQuery: null,
                filters: {
                    showDrafts: true,
                    showReady: true,
                    ageFilter: 'all',
                    reviewStatus: ['approved', 'changes-requested', 'pending'],
                    ciStatus: ['passing', 'failing', 'pending'],
                },
                sort: 'newest',
            },
            oldPullRequests: [],
        };

        // Store encrypted data
        await encryptAppData(appData);

        // Also store unencrypted for backward compatibility
        await chrome.storage.local.set({
            pullRequests: testPRs,
            'prtracker-notifications-enabled': true,
            'prtracker-filters': appData.preferences.filters,
            'prtracker-sort': 'newest',
        });

        console.log('✅ Test data injected successfully!');
        console.log(`📊 Added ${testPRs.length} test pull requests`);
        console.log(
            `👥 Added ${testUsers.length} test users as authors and reviewers`
        );
        console.log(`🔑 Password set to: ${password}`);
        console.log('🔄 Refresh the extension to see the test data');

        // Log summary of test data
        console.log('\n📋 Test Data Summary:');
        testPRs.forEach((pr, index) => {
            console.log(
                `${index + 1}. "${pr.title}" by @${pr.author.login} - ${pr.requested_reviewers.length} reviewer(s)`
            );
        });

        // Trigger storage change event to notify the extension
        window.dispatchEvent(new Event('storage'));

        // Return test data for verification
        return { testPRs, testUsers, appData };
    } catch (error) {
        console.error('❌ Error injecting test data:', error);
        console.log(
            "💡 Make sure you're running this in the extension context (popup or background page)"
        );
        throw error;
    }
}

// Export test users for direct access in tests
export const testUsers = [
    {
        login: 'alice',
        avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
    },
    {
        login: 'bob',
        avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4',
    },
    {
        login: 'carol',
        avatar_url: 'https://avatars.githubusercontent.com/u/3?v=4',
    },
    {
        login: 'dave',
        avatar_url: 'https://avatars.githubusercontent.com/u/4?v=4',
    },
    {
        login: 'eve',
        avatar_url: 'https://avatars.githubusercontent.com/u/5?v=4',
    },
    {
        login: 'frank',
        avatar_url: 'https://avatars.githubusercontent.com/u/6?v=4',
    },
    {
        login: 'grace',
        avatar_url: 'https://avatars.githubusercontent.com/u/7?v=4',
    },
    {
        login: 'henry',
        avatar_url: 'https://avatars.githubusercontent.com/u/8?v=4',
    },
    {
        login: 'iris',
        avatar_url: 'https://avatars.githubusercontent.com/u/9?v=4',
    },
    {
        login: 'jack',
        avatar_url: 'https://avatars.githubusercontent.com/u/10?v=4',
    },
    {
        login: 'kate',
        avatar_url: 'https://avatars.githubusercontent.com/u/11?v=4',
    },
    {
        login: 'luke',
        avatar_url: 'https://avatars.githubusercontent.com/u/12?v=4',
    },
    {
        login: 'mary',
        avatar_url: 'https://avatars.githubusercontent.com/u/13?v=4',
    },
    {
        login: 'noah',
        avatar_url: 'https://avatars.githubusercontent.com/u/14?v=4',
    },
    {
        login: 'olivia',
        avatar_url: 'https://avatars.githubusercontent.com/u/15?v=4',
    },
];

// Helper function to get random users for reviewers
export function getRandomReviewers(
    count: number,
    excludeAuthor: string | null = null
) {
    const availableUsers = testUsers.filter(
        (user) => user.login !== excludeAuthor
    );
    const shuffled = [...availableUsers].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
}

// Default export for backwards compatibility
export default injectTestData;
