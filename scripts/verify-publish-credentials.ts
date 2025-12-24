import { createHmac } from 'crypto';
import https from 'https';
import fs from 'fs';
import path from 'path';

// Script for verifying Chrome and Firefox publish credentials
// run npx tsx scripts/verify-publish-credentials.ts to use this script
// --- Configuration ---
// Users should set these environment variables or fill them in below for testing.
const config = {
    chrome: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
        extensionId: process.env.CHROME_EXTENSION_ID,
    },
    firefox: {
        apiKey: process.env.FIREFOX_API_KEY,
        apiSecret: process.env.FIREFOX_API_SECRET,
        extensionId: process.env.FIREFOX_EXTENSION_ID,
    },
};

// --- Helpers ---

const jwtSign = (payload: any, secret: string) => {
    const header = { alg: 'HS256', typ: 'JWT' };
    const encodeBase64 = (json: any) =>
        Buffer.from(JSON.stringify(json)).toString('base64url');
    const signatureInput = `${encodeBase64(header)}.${encodeBase64(payload)}`;
    const signature = createHmac('sha256', secret)
        .update(signatureInput)
        .digest('base64url');
    return `${signatureInput}.${signature}`;
};

const httpsRequest = (
    url: string,
    options: https.RequestOptions,
    body?: any
): Promise<any> => {
    return new Promise((resolve, reject) => {
        const req = https.request(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({ statusCode: res.statusCode, body: json });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, body: data });
                }
            });
        });
        req.on('error', reject);
        if (body) {
            req.write(typeof body === 'string' ? body : JSON.stringify(body));
        }
        req.end();
    });
};

// --- Tests ---

async function verifyChrome() {
    console.log('\n🔵 Verifying Chrome Web Store Credentials...');

    if (
        !config.chrome.clientId ||
        !config.chrome.clientSecret ||
        !config.chrome.refreshToken
    ) {
        console.error(
            '❌ Missing Chrome credentials (CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN). Skipping.'
        );
        return;
    }

    try {
        // Step 1: Refresh Access Token
        console.log('  1. Attempting to get Access Token...');
        const tokenRes = await httpsRequest(
            'https://oauth2.googleapis.com/token',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            },
            `client_id=${config.chrome.clientId}&client_secret=${config.chrome.clientSecret}&refresh_token=${config.chrome.refreshToken}&grant_type=refresh_token`
        );

        if (tokenRes.statusCode !== 200 || !tokenRes.body.access_token) {
            console.error('  ❌ Failed to get access token:', tokenRes.body);
            return;
        }
        console.log('  ✅ Access Token obtained successfully.');

        // Step 2: Fetch Extension Info (Read-only)
        if (config.chrome.extensionId) {
            console.log(
                `  2. Checking Extension ID (${config.chrome.extensionId})...`
            );
            const projection = 'DRAFT'; // or 'PUBLISHED'
            const infoRes = await httpsRequest(
                `https://www.googleapis.com/chromewebstore/v1.1/items/${config.chrome.extensionId}?projection=${projection}`,
                {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${tokenRes.body.access_token}`,
                        'x-goog-api-version': '2',
                    },
                }
            );

            if (infoRes.statusCode === 200) {
                console.log('  ✅ Extension found:', infoRes.body.item_id);
            } else {
                console.warn(
                    '  ⚠️  Extension check failed (might just be strictly private/not found, but auth worked):',
                    infoRes.body
                );
            }
        } else {
            console.log(
                '  Access token logic works. If you had an Extension ID, we would check it too.'
            );
        }
    } catch (error) {
        console.error('  ❌ Validation failed with error:', error);
    }
}

async function verifyFirefox() {
    console.log('\n🦊 Verifying Firefox Add-ons Credentials...');

    if (!config.firefox.apiKey || !config.firefox.apiSecret) {
        console.error(
            '❌ Missing Firefox credentials (API_KEY, API_SECRET). Skipping.'
        );
        return;
    }

    try {
        // Step 1: Generate JWT
        const issuedAt = Math.floor(Date.now() / 1000);
        const payload = {
            iss: config.firefox.apiKey,
            jti: Math.random().toString(),
            iat: issuedAt,
            exp: issuedAt + 60, // 1 minute expiration
        };
        const token = jwtSign(payload, config.firefox.apiSecret);

        // Step 2: Make a Read-Only Request (Get User Profile)
        console.log('  1. Attempting to fetch authenticated user profile...');
        const res = await httpsRequest(
            'https://addons.mozilla.org/api/v5/accounts/profile/',
            {
                method: 'GET',
                headers: { Authorization: `JWT ${token}` },
            }
        );

        if (res.statusCode === 200) {
            console.log(
                `  ✅ Credentials valid! Logged in as: ${res.body.name || res.body.email || 'Unknown User'}`
            );
        } else {
            console.error(
                '  ❌ Failed to verify Firefox credentials:',
                res.body
            );
        }
    } catch (error) {
        console.error('  ❌ Firefox validation failed:', error);
    }
}

// --- Main ---

async function main() {
    // Attempt to load .env manually if dotenv not present, or assume keys are set
    try {
        const envPath = path.resolve(process.cwd(), '.env');
        if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf-8');
            envContent.split('\n').forEach((line) => {
                const [key, value] = line.split('=');
                if (key && value && !process.env[key.trim()]) {
                    process.env[key.trim()] = value.trim();
                }
            });
            // Reload config from env
            config.chrome.clientId = process.env.GOOGLE_CLIENT_ID;
            config.chrome.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
            config.chrome.refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
            config.chrome.extensionId = process.env.CHROME_EXTENSION_ID;
            config.firefox.apiKey = process.env.FIREFOX_API_KEY;
            config.firefox.apiSecret = process.env.FIREFOX_API_SECRET;
        }
    } catch (error) {
        console.error('Failed to load .env file:', error);
    }

    await verifyChrome();
    await verifyFirefox();
}

main();
