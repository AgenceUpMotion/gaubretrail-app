import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(scrypt);

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(password, salt, 64);
  return `scrypt:${salt}:${key.toString('hex')}`;
}

export function validPasswordHash(hash) {
  return /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash || '');
}

export async function verifyPassword(password, hash) {
  if (!validPasswordHash(hash) || typeof password !== 'string' || password.length > 256) return false;
  const [, salt, expected] = hash.split(':');
  const key = await deriveKey(password, salt, 64);
  return timingSafeEqual(key, Buffer.from(expected, 'hex'));
}
