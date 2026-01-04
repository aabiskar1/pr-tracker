import https from 'https';
import readline from 'readline';
import fs from 'fs';
import path from 'path';

// Load .env file
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach((line) => {
        const [key, value] = line.split('=');
        if (key && value && !process.env[key.trim()]) {
            process.env[key.trim()] = value.trim();
        }
    });
}

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error(
        '❌ Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env file.'
    );
    process.exit(1);
}

// User requested this specific Redirect URI
const REDIRECT_URI = 'https://developers.google.com/oauthplayground';
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const AUTH_URL = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=${SCOPE}&access_type=offline&prompt=consent`;

console.log('\n🔑 Chrome Web Store Token Generator');
console.log('-----------------------------------');
console.log(`Redirect URI: ${REDIRECT_URI}`);

console.log('\n1. Open this URL in your browser:');
console.log('\n' + AUTH_URL + '\n');
console.log('2. Sign in and authorize access.');
console.log('3. You will be redirected to the OAuth Playground.');
console.log(
    '4. LOOK AT THE URL BAR (or the "Authorization code" box in Playground).'
);
console.log('5. Copy the code (the value after "code=").');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

rl.question('\n📝 Paste the Authorization Code here: ', (code) => {
    rl.close();
    code = code.trim();

    if (!code) {
        console.error('❌ No code provided.');
        process.exit(1);
    }

    console.log('\n🔄 Exchanging code for tokens...');

    const postData = JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI, // Must match the one used in the auth request
    });

    const options = {
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': postData.length,
        },
    };

    const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
            data += chunk;
        });

        res.on('end', () => {
            try {
                const response = JSON.parse(data);

                if (response.error) {
                    console.error('❌ Error getting token:', response);
                    return;
                }

                console.log('\n✅ Success! Here are your credentials:\n');
                console.log('ACCESS_TOKEN:');
                console.log(response.access_token);
                console.log(
                    '\nREFRESH_TOKEN (Save this to GitHub Secrets as GOOGLE_REFRESH_TOKEN):'
                );
                console.log('\x1b[32m%s\x1b[0m', response.refresh_token); // Green color

                if (!response.refresh_token) {
                    console.warn(
                        '\n⚠️ No refresh_token returned. Did you revoke access first?'
                    );
                }
            } catch (e) {
                console.error('❌ Failed to parse response:', data);
            }
        });
    });

    req.on('error', (e) => {
        console.error('❌ Request error:', e);
    });

    req.write(postData);
    req.end();
});
