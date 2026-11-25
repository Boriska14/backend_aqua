import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt,
} from 'crypto';

const BASE62_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function generateNumericOtp(digits = 6): string {
  const max = 10 ** digits;
  return randomInt(0, max).toString().padStart(digits, '0');
}

export function generateBase62Token(byteLength = 16): string {
  const bytes = randomBytes(byteLength);
  let value = BigInt('0x' + bytes.toString('hex'));
  let result = '';
  const base = BigInt(62);
  while (value > 0n) {
    const rem = Number(value % base);
    result = BASE62_ALPHABET[rem] + result;
    value /= base;
  }
  while (result.length < 22) {
    result = BASE62_ALPHABET[randomInt(0, 62)] + result;
  }
  return result;
}

export function generateRandomTrackingNumber(prefix = 'SG'): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[randomInt(0, chars.length)];
  }
  return `${prefix}-${code}`;
}

export function encryptAes256Gcm(
  plaintext: string,
  hexKey: string,
): { encryptedSecret: string; iv: string; authTag: string } {
  const key = Buffer.from(hexKey, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedSecret: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export function decryptAes256Gcm(
  encryptedSecret: string,
  ivBase64: string,
  authTagBase64: string,
  hexKey: string,
): string {
  const key = Buffer.from(hexKey, 'hex');
  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedSecret, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function normalizeCameroonPhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-().]/g, '');
  if (/^\+2376\d{8}$/.test(cleaned)) {
    return cleaned;
  }
  if (/^2376\d{8}$/.test(cleaned)) {
    return `+${cleaned}`;
  }
  if (/^6\d{8}$/.test(cleaned)) {
    return `+237${cleaned}`;
  }
  if (/^\+[1-9]\d{7,14}$/.test(cleaned)) {
    return cleaned;
  }
  return null;
}
