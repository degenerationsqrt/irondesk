const GROUP_ID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;
const INVITE_CODE_PATTERN = /^[A-Z0-9]{6,32}$/;

export function buildCrewInviteToken(groupId, code) {
  const cleanGroupId = String(groupId || "").trim();
  const cleanCode = String(code || "").trim();
  if (cleanCode.includes(".")) {
    try {
      return parseCrewInviteToken(cleanCode).token;
    } catch {
      return "";
    }
  }
  if (!GROUP_ID_PATTERN.test(cleanGroupId) || !INVITE_CODE_PATTERN.test(cleanCode.toUpperCase())) {
    return "";
  }
  return `${cleanGroupId}.${cleanCode.toUpperCase()}`;
}

export function parseCrewInviteToken(value) {
  const token = String(value || "").trim();
  const separator = token.lastIndexOf(".");
  if (separator <= 0 || separator === token.length - 1) {
    throw new Error("Paste the full crew invite code. Ask a member to copy it again from IronDesk.");
  }

  const groupId = token.slice(0, separator);
  const code = token.slice(separator + 1).toUpperCase();
  if (!GROUP_ID_PATTERN.test(groupId) || !INVITE_CODE_PATTERN.test(code)) {
    throw new Error("This crew invite code is not valid.");
  }
  return {
    groupId,
    code,
    token: `${groupId}.${code}`,
  };
}
