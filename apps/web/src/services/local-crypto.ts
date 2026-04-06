const LOCAL_CRYPTO_KEY_STORAGE_KEY = "todolist.web.local-crypto-key";
const LOCAL_CRYPTO_PREFIX = "locv1";
const LOCAL_CRYPTO_IV_LENGTH = 12;
const LOCAL_CRYPTO_KEY_LENGTH = 32;

let cachedLocalCryptoKeyPromise: Promise<CryptoKey> | null = null;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalizedValue = value.replace(/-/g, "+").replace(/_/g, "/");
  const paddedValue = normalizedValue + "=".repeat((4 - (normalizedValue.length % 4 || 4)) % 4);
  const binary = atob(paddedValue);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function createRandomKeyBytes(): Uint8Array {
  const bytes = new Uint8Array(LOCAL_CRYPTO_KEY_LENGTH);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function resolveLocalCryptoKey(): Promise<CryptoKey> {
  if (cachedLocalCryptoKeyPromise) {
    return cachedLocalCryptoKeyPromise;
  }

  cachedLocalCryptoKeyPromise = (async () => {
    const savedKey = window.localStorage.getItem(LOCAL_CRYPTO_KEY_STORAGE_KEY);
    const keyBytes = savedKey ? base64UrlToBytes(savedKey) : createRandomKeyBytes();

    if (!savedKey) {
      window.localStorage.setItem(LOCAL_CRYPTO_KEY_STORAGE_KEY, bytesToBase64Url(keyBytes));
    }

    return crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), "AES-GCM", false, [
      "encrypt",
      "decrypt"
    ]);
  })();

  return cachedLocalCryptoKeyPromise;
}

export function isLocalEncryptedString(value: string): boolean {
  return value.startsWith(`${LOCAL_CRYPTO_PREFIX}:`);
}

export async function encryptLocalString(
  value: string | null | undefined
): Promise<string | null | undefined> {
  if (value === undefined || value === null) {
    return value;
  }

  if (isLocalEncryptedString(value)) {
    return value;
  }

  const key = await resolveLocalCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(LOCAL_CRYPTO_IV_LENGTH));
  const plaintext = new TextEncoder().encode(value);
  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv
    },
    key,
    plaintext
  );

  return `${LOCAL_CRYPTO_PREFIX}:${bytesToBase64Url(iv)}:${bytesToBase64Url(new Uint8Array(encryptedBuffer))}`;
}

export async function decryptLocalString(
  value: string | null | undefined
): Promise<string | null | undefined> {
  if (value === undefined || value === null) {
    return value;
  }

  if (!isLocalEncryptedString(value)) {
    return value;
  }

  const [prefix, ivText, encryptedText] = value.split(":");
  if (prefix !== LOCAL_CRYPTO_PREFIX || !ivText || !encryptedText) {
    return null;
  }

  try {
    const key = await resolveLocalCryptoKey();
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(base64UrlToBytes(ivText))
      },
      key,
      toArrayBuffer(base64UrlToBytes(encryptedText))
    );

    return new TextDecoder().decode(decryptedBuffer);
  } catch {
    return null;
  }
}
