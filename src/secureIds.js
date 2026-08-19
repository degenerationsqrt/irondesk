const RECORD_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

let fallbackCounter = 0;

function randomCharacters(length, alphabet, cryptoSource) {
  if (typeof cryptoSource?.getRandomValues !== "function") return "";
  const output = [];
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;

  while (output.length < length) {
    const bytes = new Uint8Array(Math.max(16, (length - output.length) * 2));
    cryptoSource.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= limit) continue;
      output.push(alphabet[byte % alphabet.length]);
      if (output.length === length) break;
    }
  }
  return output.join("");
}

export function createRecordId(cryptoSource = globalThis.crypto, now = Date.now) {
  if (typeof cryptoSource?.randomUUID === "function") return cryptoSource.randomUUID();
  const randomId = randomCharacters(20, RECORD_ALPHABET, cryptoSource);
  if (randomId) return randomId;

  fallbackCounter += 1;
  return `local-${Number(now()).toString(36)}-${fallbackCounter.toString(36)}`;
}

export function createInviteCode(cryptoSource = globalThis.crypto) {
  const code = randomCharacters(10, INVITE_ALPHABET, cryptoSource);
  if (!code) {
    throw new Error("Secure invitations require a current browser or the installed IronDesk app.");
  }
  return code;
}
