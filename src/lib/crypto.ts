import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Chiffrement AES-256-GCM des jetons d'intégration (clé ENCRYPTION_KEY : 32 octets en base64).
 * Format : v1.<iv>.<tag>.<données> (base64url).
 */

function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("ENCRYPTION_KEY n'est pas configurée (32 octets en base64 : openssl rand -base64 32).");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("ENCRYPTION_KEY doit faire 32 octets une fois décodée (openssl rand -base64 32).");
  return k;
}

export const hasEncryptionKey = (): boolean => {
  try {
    key();
    return true;
  } catch {
    return false;
  }
};

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(token: string): string {
  const [v, iv, tag, data] = token.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Jeton chiffré illisible.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}
