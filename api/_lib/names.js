// Player names appear on the public leaderboard. Letters in any language (including
// Bangla), marks, digits, spaces, _ . - ; 1 to 16 characters; always shown as plain text.
const NAME_PATTERN = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} _.-]*$/u;
const MAX_NAME_LENGTH = 16;

export function cleanName(value) {
  if (typeof value !== "string") {
    return null;
  }
  const name = value.normalize("NFC").replace(/\s+/g, " ").trim();
  const length = [...name].length;
  return length >= 1 && length <= MAX_NAME_LENGTH && NAME_PATTERN.test(name) ? name : null;
}
