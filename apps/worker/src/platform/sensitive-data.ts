const DEFAULT_ERROR_MESSAGE = "同步失敗，但未取得錯誤原因。";
const DEFAULT_MAX_LENGTH = 300;

const SENSITIVE_FIELD_PATTERN =
  /(["']?(?:authorization|cookie|set-cookie|password|passwd|token|secret|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|session(?:[_-]?(?:cookies?|id))?|otp|pin|mobile|user[_-]?id|account|custid|login[_-]?id|invoice(?:[_-]?(?:number|id))?|tax[_-]?id|card[_-]?number)["']?\s*[:=]\s*["']?)([^"'\s,;}&]+)/gi;

/**
 * The single redaction boundary for data that can reach D1, logs, or API
 * responses. Keep this function dependency-free so every Worker feature can
 * use the same policy without importing another feature's service module.
 */
export function maskSensitiveData(
  value: string,
  maxLength = DEFAULT_MAX_LENGTH,
  knownSecrets: readonly (string | undefined)[] = [],
) {
  let masked = value.replace(/\s+/g, " ").trim();

  for (const secret of [...knownSecrets]
    .filter((item): item is string => Boolean(item && item.length >= 3))
    .sort((left, right) => right.length - left.length)) {
    masked = masked.split(secret).join("[redacted]");
  }

  return masked
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL]")
    .replace(SENSITIVE_FIELD_PATTERN, "$1[redacted]")
    .replace(
      /\b(?:Bearer\s+)?eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
      "[JWT]",
    )
    .replace(
      /\b(?=[A-Za-z0-9+/_=-]{24,}\b)(?=[A-Za-z0-9+/_=-]*[A-Z])(?=[A-Za-z0-9+/_=-]*[a-z])(?=[A-Za-z0-9+/_=-]*\d)[A-Za-z0-9+/_=-]{24,}\b/g,
      "[redacted]",
    )
    .slice(0, maxLength);
}

export function sanitizeErrorMessage(
  error: unknown,
  knownSecrets: readonly (string | undefined)[] = [],
) {
  const rawMessage =
    error instanceof Error
      ? error.message
      : error === null || error === undefined
        ? ""
        : String(error);
  return (
    maskSensitiveData(rawMessage, DEFAULT_MAX_LENGTH, knownSecrets) ||
    DEFAULT_ERROR_MESSAGE
  );
}

export function sanitizeErrorForLog(
  error: unknown,
  knownSecrets: readonly (string | undefined)[] = [],
) {
  const safeError = new Error(sanitizeErrorMessage(error, knownSecrets));
  if (error instanceof Error) {
    const safeName = maskSensitiveData(error.name, 80, knownSecrets);
    if (safeName && safeName !== "Error") safeError.name = safeName;
  }
  return safeError;
}

export function sanitizeErrorLogDetails(
  error: unknown,
  knownSecrets: readonly (string | undefined)[] = [],
) {
  const errorName = maskSensitiveData(
    error instanceof Error ? error.name : typeof error,
    80,
    knownSecrets,
  );
  const stack =
    error instanceof Error
      ? maskSensitiveData(
          (error.stack ?? "").split("\n").slice(1).join("\n"),
          1_500,
          knownSecrets,
        )
      : "";
  const cause = error instanceof Error ? error.cause : undefined;
  const causeName =
    cause instanceof Error
      ? maskSensitiveData(cause.name, 80, knownSecrets) || "UnknownError"
      : "";
  const causeStack =
    cause instanceof Error
      ? maskSensitiveData(
          (cause.stack ?? "").split("\n").slice(1).join("\n"),
          500,
          knownSecrets,
        )
      : "";
  const stage =
    error instanceof Error &&
    "stage" in error &&
    typeof error.stage === "string"
      ? maskSensitiveData(error.stage, 80, knownSecrets)
      : "";

  return {
    errorName: errorName || "UnknownError",
    ...(stage ? { stage } : {}),
    ...(stack ? { stack } : {}),
    ...(causeName ? { causeName } : {}),
    ...(causeStack ? { causeStack } : {}),
  };
}
