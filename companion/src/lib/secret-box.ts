import {
  aesDecryptAsync,
  aesEncryptAsync,
  AESEncryptionKey,
  AESSealedData,
} from "expo-crypto";

/**
 * AES-256-GCM, matching the launcher's src/main/services/settings-sync/
 * secret-box.ts: a 12-byte IV, a 16-byte tag, and each part in base64.
 */
export interface SealedBox {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

export const isSealedBox = (value: unknown): value is SealedBox =>
  !!value &&
  typeof value === "object" &&
  (value as SealedBox).v === 1 &&
  typeof (value as SealedBox).iv === "string" &&
  typeof (value as SealedBox).tag === "string" &&
  typeof (value as SealedBox).data === "string";

/** The shared key, as the launcher stores it in `Nacho/sync-key`. */
export const importSyncKey = async (base64: string) => {
  const key = await AESEncryptionKey.import(base64.trim(), "base64");
  if (key.size !== 256) throw new Error("The settings sync key is the wrong size.");
  return key;
};

const utf8Encode = (text: string) => {
  const bytes: number[] = [];
  for (const char of text) {
    let code = char.codePointAt(0) ?? 0;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return new Uint8Array(bytes);
};

const utf8Decode = (bytes: Uint8Array) => {
  let text = "";
  for (let i = 0; i < bytes.length; ) {
    const byte = bytes[i];
    let code: number;
    let extra: number;
    if (byte < 0x80) [code, extra] = [byte, 0];
    else if (byte < 0xe0) [code, extra] = [byte & 0x1f, 1];
    else if (byte < 0xf0) [code, extra] = [byte & 0x0f, 2];
    else [code, extra] = [byte & 0x07, 3];
    for (let j = 1; j <= extra; j++) code = (code << 6) | (bytes[i + j] & 0x3f);
    text += String.fromCodePoint(code);
    i += extra + 1;
  }
  return text;
};

export const sealJson = async (
  key: AESEncryptionKey,
  value: unknown
): Promise<SealedBox> => {
  const sealed = await aesEncryptAsync(utf8Encode(JSON.stringify(value)), key, {
    nonce: { length: 12 },
    tagLength: 16,
  });
  return {
    v: 1,
    iv: await sealed.iv("base64"),
    tag: await sealed.tag("base64"),
    data: await sealed.ciphertext({ includeTag: false, encoding: "base64" }),
  };
};

export const openJson = async <T>(
  key: AESEncryptionKey,
  box: SealedBox
): Promise<T> => {
  const sealed = AESSealedData.fromParts(box.iv, box.data, box.tag);
  const plain = await aesDecryptAsync(sealed, key, { output: "bytes" });
  return JSON.parse(utf8Decode(plain)) as T;
};
