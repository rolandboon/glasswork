import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt) as (
  password: string,
  salt: string,
  length: number
) => Promise<Buffer>;

export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    return `${salt}:${(await derive(password, salt, 64)).toString('hex')}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const expected = Buffer.from(hash, 'hex');
    const actual = await derive(password, salt, expected.length);
    return timingSafeEqual(actual, expected);
  }
}
