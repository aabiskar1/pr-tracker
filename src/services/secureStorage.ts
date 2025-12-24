import browser from 'webextension-polyfill';
import {
    SaltSchema,
    TestVectorSchema,
    EncryptedDataSchema,
    EncryptedTokenSchema,
} from './storageSchemas';

/**
 * Enhanced secure storage service for handling ALL sensitive data
 * Uses the Web Crypto API to encrypt data before storing it
 * Combines extension ID with a user password for enhanced security
 */

// Constants for storage
const SALT_KEY = 'prtracker_salt';
const TOKEN_KEY = 'encryptedGithubToken';
const IV_KEY = 'prtracker_iv';
const TEST_KEY = 'encryptionTestVector';

// New constants for encrypted app data
const ENCRYPTED_DATA_KEY = 'encryptedAppData';
const DATA_IV_KEY = 'appDataIv';

// Generate a random initialization vector for AES-GCM
const generateIV = (): Uint8Array => {
    return crypto.getRandomValues(new Uint8Array(12)); // 12 bytes for AES-GCM
};

// Derive an encryption key from both the extension ID and user password
const getEncryptionKey = async (userPassword: string): Promise<CryptoKey> => {
    // Get or generate a salt
    const result = await browser.storage.local.get(SALT_KEY);
    const parsed = SaltSchema.safeParse(result);
    const existingSalt = parsed.success ? parsed.data[SALT_KEY] : undefined;

    let saltArray: Uint8Array;

    if (existingSalt) {
        saltArray = new Uint8Array(existingSalt);
    } else {
        // Generate a new salt if none exists
        saltArray = crypto.getRandomValues(new Uint8Array(16));
        await browser.storage.local.set({ [SALT_KEY]: Array.from(saltArray) });
    }

    // Get a unique browser identifier - adds entropy but isn't the sole secret
    const extensionInfo = await browser.management.getSelf();
    const browserKey = extensionInfo.id;

    // Combine extension ID with user password to create a stronger secret
    const combinedKey = browserKey + ':' + userPassword;

    // Convert string to byte array for key derivation
    const encoder = new TextEncoder();
    const keyData = encoder.encode(combinedKey);

    // Import as raw key material first
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
    );

    // Derive actual encryption key using PBKDF2
    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: saltArray as BufferSource,
            iterations: 100000, // High iteration count for security
            hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
};

// Create and store an encrypted test vector to validate the password later
export const setupEncryption = async (password: string): Promise<boolean> => {
    try {
        const key = await getEncryptionKey(password);
        const iv = generateIV();

        // Create a known test value that we can verify later
        const testValue = 'PR_TRACKER_VALID';
        const encoder = new TextEncoder();
        const testData = encoder.encode(testValue);

        // Encrypt the test value
        const encryptedData = await crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: iv as BufferSource,
            },
            key,
            testData
        );

        // Store the encrypted test value and IV
        const encryptedArray = Array.from(new Uint8Array(encryptedData));
        const ivArray = Array.from(iv);

        await browser.storage.local.set({
            [TEST_KEY]: {
                data: encryptedArray,
                iv: ivArray,
            },
        });

        return true;
    } catch (error) {
        console.error('Error setting up encryption:', error);
        return false;
    }
};

// Validate if the provided password is correct by attempting to decrypt the test vector
export const validatePassword = async (password: string): Promise<boolean> => {
    try {
        const result = await browser.storage.local.get(TEST_KEY);
        const parsed = TestVectorSchema.safeParse(result);
        const testVector = parsed.success ? parsed.data[TEST_KEY] : undefined;

        if (!testVector) {
            return false;
        }

        const key = await getEncryptionKey(password);

        // Convert back to Uint8Array
        const encryptedData = new Uint8Array(testVector.data);
        const iv = new Uint8Array(testVector.iv).slice() as Uint8Array;

        // Try to decrypt
        const decryptedData = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: iv as BufferSource,
            },
            key,
            encryptedData
        );

        // Convert back to string
        const decoder = new TextDecoder();
        const decrypted = decoder.decode(decryptedData);

        return decrypted === 'PR_TRACKER_VALID';
    } catch {
        // Decryption failure means wrong password
        return false;
    }
};

// Encrypt and store all application data
export const encryptAppData = async (
    data: Record<string, unknown>,
    password: string
): Promise<void> => {
    try {
        const key = await getEncryptionKey(password);
        const iv = generateIV();

        // Serialize the data to JSON
        const dataString = JSON.stringify(data);
        const encoder = new TextEncoder();
        const dataBytes = encoder.encode(dataString);

        // Encrypt
        const encryptedData = await crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: iv as BufferSource,
            },
            key,
            dataBytes
        );

        // Convert to arrays for storage
        const encryptedArray = Array.from(new Uint8Array(encryptedData));
        const ivArray = Array.from(iv);

        // Store both encrypted data and IV
        await browser.storage.local.set({
            [ENCRYPTED_DATA_KEY]: encryptedArray,
            [DATA_IV_KEY]: ivArray,
        });

        console.log('App data encrypted and stored securely');
    } catch (error) {
        console.error('Error encrypting app data:', error);
        throw new Error('Failed to securely store app data');
    }
};

// Decrypt and retrieve all application data
export const decryptAppData = async <T = Record<string, unknown>>(
    password: string
): Promise<T | null> => {
    try {
        const result = await browser.storage.local.get([
            ENCRYPTED_DATA_KEY,
            DATA_IV_KEY,
        ]);
        const parsed = EncryptedDataSchema.safeParse(result);
        const encryptedArray = parsed.success
            ? parsed.data[ENCRYPTED_DATA_KEY]
            : undefined;
        const ivArray = parsed.success ? parsed.data[DATA_IV_KEY] : undefined;

        if (!encryptedArray || !ivArray) {
            console.log('No encrypted app data found');
            return {} as T;
        }

        const key = await getEncryptionKey(password);

        // Convert back to Uint8Array
        const encryptedData = new Uint8Array(encryptedArray);
        const iv = new Uint8Array(ivArray);

        // Decrypt
        const decryptedData = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: iv as BufferSource,
            },
            key,
            encryptedData
        );

        // Convert back to string and parse JSON
        const decoder = new TextDecoder();
        const dataString = decoder.decode(decryptedData);
        return JSON.parse(dataString);
    } catch (error) {
        console.error('Error decrypting app data:', error);
        return null;
    }
};

// Encrypt the token with the user's password
export const encryptToken = async (
    token: string,
    password: string
): Promise<void> => {
    try {
        const key = await getEncryptionKey(password);
        const iv = generateIV();

        // Encode the token string to bytes
        const encoder = new TextEncoder();
        const tokenData = encoder.encode(token);

        // Encrypt
        const encryptedData = await crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: iv as BufferSource,
            },
            key,
            tokenData
        );

        // Convert to array for storage
        const encryptedArray = Array.from(new Uint8Array(encryptedData));
        const ivArray = Array.from(iv);

        // Store both encrypted data and IV
        await browser.storage.local.set({
            [TOKEN_KEY]: encryptedArray,
            [IV_KEY]: ivArray,
        });

        // Also set up the test vector if not already present
        const { [TEST_KEY]: testVector } =
            await browser.storage.local.get(TEST_KEY);
        if (!testVector) {
            await setupEncryption(password);
        }

        console.log('Token encrypted and stored securely');
    } catch (error) {
        console.error('Error encrypting token:', error);
        throw new Error('Failed to securely store token');
    }
};

// Decrypt the token with the user's password
export const decryptToken = async (
    password: string
): Promise<string | null> => {
    try {
        const result = await browser.storage.local.get([TOKEN_KEY, IV_KEY]);
        const parsed = EncryptedTokenSchema.safeParse(result);
        const encryptedArray = parsed.success
            ? parsed.data[TOKEN_KEY]
            : undefined;
        const ivArray = parsed.success ? parsed.data[IV_KEY] : undefined;

        if (!encryptedArray || !ivArray) {
            console.log('No encrypted token found');
            return null;
        }

        const key = await getEncryptionKey(password);

        // Convert back to Uint8Array
        const encryptedData = new Uint8Array(encryptedArray);
        const iv = new Uint8Array(ivArray);

        // Decrypt
        const decryptedData = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: iv as BufferSource,
            },
            key,
            encryptedData
        );

        // Convert back to string
        const decoder = new TextDecoder();
        return decoder.decode(decryptedData);
    } catch {
        console.error('Error decrypting token');
        return null;
    }
};

// Check if a token exists
export const hasStoredToken = async (): Promise<boolean> => {
    const result = await browser.storage.local.get(TOKEN_KEY);
    const parsed = EncryptedTokenSchema.safeParse(result);
    return parsed.success && !!parsed.data[TOKEN_KEY];
};

// Check if encryption has been set up (password created)
export const hasEncryptionSetup = async (): Promise<boolean> => {
    const result = await browser.storage.local.get(TEST_KEY);
    const parsed = TestVectorSchema.safeParse(result);
    return parsed.success && !!parsed.data[TEST_KEY];
};

// Remove token
export const removeToken = async (): Promise<void> => {
    await browser.storage.local.remove([TOKEN_KEY, IV_KEY]);
    console.log('Token removed from secure storage');
};

// Clear all secure storage (for complete reset)
export const clearSecureStorage = async (): Promise<void> => {
    await browser.storage.local.remove([
        TOKEN_KEY,
        IV_KEY,
        TEST_KEY,
        SALT_KEY,
        ENCRYPTED_DATA_KEY,
        DATA_IV_KEY,
    ]);
    console.log('All secure storage cleared');
};
