import z from 'zod';

const tokenSchema = z.string().min(1, 'Token cannot be empty');

export function validateToken(token: unknown) {
    return tokenSchema.parse(token);
}
