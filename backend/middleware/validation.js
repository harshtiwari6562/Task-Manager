import { z } from 'zod';

const COMMON_PASSWORDS = new Set([
  'password123',
  'password1234',
  '1234567890',
  '123456789012',
  'admin12345',
  'qwertyuiop',
  'welcome1234',
  'letmein1234',
  'monkey12345',
  'dragon12345',
  'master12345',
]);

export const registerSchema = z.object({
  name: z
    .string({ required_error: 'Name is required' })
    .trim()
    .min(1, 'Name must be at least 1 character')
    .max(60, 'Name must not exceed 60 characters'),
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Please provide a valid email address')
    .max(254, 'Email must not exceed 254 characters'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(6, 'Password must be between 6 and 10 characters')
    .max(10, 'Password must be between 6 and 10 characters'),
});

export const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Please provide a valid email address')
    .max(254, 'Email must not exceed 254 characters'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, 'Password is required')
    .max(128, 'Password must not exceed 128 characters'),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string({ required_error: 'Current password is required' }).min(1),
  newPassword: z
    .string({ required_error: 'New password is required' })
    .min(6, 'New password must be between 6 and 10 characters')
    .max(10, 'New password must be between 6 and 10 characters'),
});

export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body || {});
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      return res.status(400).json({ error: firstIssue?.message || 'Invalid input' });
    }
    req.body = result.data;
    next();
  };
}
