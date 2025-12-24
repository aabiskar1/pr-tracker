import { z } from 'zod';

// Byte array schema (for stored Uint8Arrays)
export const ByteArraySchema = z.array(z.number());

// Session Storage Schema
export const SessionStorageSchema = z.object({
    sessionPassword: z.string().optional(),
    rememberPasswordFlag: z.boolean().optional(),
});

// Secure Storage Schemas
export const SaltSchema = z.object({
    prtracker_salt: ByteArraySchema.optional(),
});

export const TestVectorSchema = z.object({
    encryptionTestVector: z
        .object({
            data: ByteArraySchema,
            iv: ByteArraySchema,
        })
        .optional(),
});

export const EncryptedDataSchema = z.object({
    encryptedAppData: ByteArraySchema.optional(),
    appDataIv: ByteArraySchema.optional(),
});

export const EncryptedTokenSchema = z.object({
    encryptedGithubToken: ByteArraySchema.optional(),
    prtracker_iv: ByteArraySchema.optional(),
});

// Theme Schema
export const ThemePreferenceSchema = z.enum(['light', 'dark', 'auto']);
export const ThemeStorageSchema = z.object({
    'theme-preference': ThemePreferenceSchema.optional(),
});

// Generic schemas for when we need to validate just one field but get flexible input
export const SingleStringSchema = z.string();
export const SingleBooleanSchema = z.boolean();
