import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedSecret {
  readonly algorithm: "AES-256-GCM" | "KMS";
  readonly keyVersion: string;
  readonly ciphertext: string;
  readonly iv?: string;
  readonly authTag?: string;
}
export interface SecretEncryptionPort {
  encrypt(plaintext: string, context: Readonly<Record<string, string>>): Promise<EncryptedSecret>;
  decrypt(envelope: EncryptedSecret, context: Readonly<Record<string, string>>): Promise<string>;
}
/** Production implementations should use a cloud KMS envelope-encryption adapter. */
export interface ProductionKmsPort extends SecretEncryptionPort {
  readonly provider: "aws-kms" | "gcp-kms" | "azure-key-vault";
}

export class LocalAes256GcmEncryption implements SecretEncryptionPort {
  constructor(private readonly key: Uint8Array, private readonly keyVersion = "local-v1") {
    if (key.byteLength !== 32) throw new Error("AES-256-GCM requires exactly 32 key bytes.");
  }
  async encrypt(plaintext: string, context: Readonly<Record<string, string>>): Promise<EncryptedSecret> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(canonicalContext(context)));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return { algorithm: "AES-256-GCM", keyVersion: this.keyVersion, ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
  }
  async decrypt(envelope: EncryptedSecret, context: Readonly<Record<string, string>>): Promise<string> {
    if (envelope.algorithm !== "AES-256-GCM" || !envelope.iv || !envelope.authTag) throw new Error("Unsupported encrypted secret envelope.");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(Buffer.from(canonicalContext(context)));
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
  }
}
function canonicalContext(context: Readonly<Record<string, string>>): string {
  return JSON.stringify(Object.entries(context).sort(([a], [b]) => a.localeCompare(b)));
}
