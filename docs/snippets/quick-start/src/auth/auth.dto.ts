import { email, minLength, object, pipe, string } from 'valibot';

export const LoginDto = object({
  email: pipe(string(), email()),
  password: pipe(string(), minLength(8)),
});

export const SessionDto = object({
  token: string(),
  expiresAt: string(),
});
