import type { MiddlewareHandler } from "hono";
import type { AppBindings } from "../platform/env";
import { honoFactory } from "../platform/hono";
import { jsonError } from "../platform/http";
import { sanitizeErrorForLog } from "../platform/sensitive-data";

export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
export const MAX_OCR_BODY_BYTES = 256 * 1024;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const PRODUCTION_ORIGIN = "https://finance.shawnup.com";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LOCAL_RATE_LIMITS = {
  api: { limit: 120, windowMs: 60_000 },
  expensive: { limit: 30, windowMs: 60_000 },
} as const;

const localRateLimitWindows = new Map<
  string,
  { count: number; windowStartedAt: number }
>();

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the allowed size.");
    this.name = "RequestBodyTooLargeError";
  }
}

export const requestSecurityMiddleware: MiddlewareHandler<AppBindings> =
  honoFactory.createMiddleware(async (c, next) => {
    if (SAFE_METHODS.has(c.req.method.toUpperCase())) {
      await next();
      return;
    }

    const requestUrl = new URL(c.req.url);
    if (!isAllowedOrigin(c.req.raw, requestUrl.hostname, c.env.APP_ORIGINS)) {
      console.warn("[security] request origin rejected", {
        origin: safeLogOrigin(c.req.header("Origin")),
        referer: safeLogOrigin(c.req.header("Referer")),
        host: requestUrl.hostname,
      });
      return jsonError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
    }

    const contentLength = c.req.header("Content-Length");
    if (contentLength !== undefined) {
      const length = Number(contentLength);
      if (!Number.isSafeInteger(length) || length < 0) {
        return jsonError(
          "INVALID_CONTENT_LENGTH",
          "Invalid request body.",
          400,
        );
      }
      if (length > MAX_REQUEST_BODY_BYTES) {
        return jsonError(
          "REQUEST_TOO_LARGE",
          "Request body is too large.",
          413,
        );
      }
    }

    const resource = requestResource(requestUrl.pathname);
    const limiter =
      resource === "api"
        ? c.env.API_RATE_LIMITER
        : c.env.EXPENSIVE_RATE_LIMITER;
    if (!limiter) {
      if (!isLocalRateLimitEnvironment(c.env, requestUrl.hostname)) {
        return jsonError(
          "RATE_LIMIT_UNAVAILABLE",
          "Request protection is temporarily unavailable.",
          503,
        );
      }
      const result = localRateLimit(resource);
      if (!result.success) {
        const response = jsonError(
          "RATE_LIMITED",
          "Too many requests. Please try again later.",
          429,
        );
        response.headers.set("Retry-After", String(result.retryAfter));
        return response;
      }
    } else {
      try {
        const result = await limiter.limit({ key: `single-user:${resource}` });
        if (!result.success) {
          const response = jsonError(
            "RATE_LIMITED",
            "Too many requests. Please try again later.",
            429,
          );
          response.headers.set("Retry-After", "60");
          return response;
        }
      } catch (error) {
        console.error(
          "[security] rate limit check failed",
          sanitizeErrorForLog(error),
        );
        if (!isLocalRateLimitEnvironment(c.env, requestUrl.hostname)) {
          return jsonError(
            "RATE_LIMIT_UNAVAILABLE",
            "Request protection is temporarily unavailable.",
            503,
          );
        }
      }
    }

    await next();
  });

export async function readRequestBodyWithLimit(
  request: Request,
  maxBytes: number,
) {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (Number.isSafeInteger(length) && length > maxBytes) {
      throw new RequestBodyTooLargeError();
    }
  }

  if (!request.body) return new ArrayBuffer(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new RequestBodyTooLargeError();
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

function isAllowedOrigin(
  request: Request,
  hostname: string,
  configuredOrigins?: string,
) {
  const origin = request.headers.get("Origin");
  const referer = request.headers.get("Referer");
  const allowedOrigins = new Set(
    (configuredOrigins?.trim() || PRODUCTION_ORIGIN)
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean),
  );

  if (LOCAL_HOSTS.has(hostname)) {
    allowedOrigins.add(new URL(request.url).origin);
  }

  if (origin === "null") {
    if (referer === null) return false;
    try {
      return allowedOrigins.has(new URL(referer).origin);
    } catch {
      return false;
    }
  }

  if (origin !== null && !allowedOrigins.has(origin)) return false;

  if (origin === null && referer !== null) {
    try {
      if (!allowedOrigins.has(new URL(referer).origin)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function isLocalRateLimitEnvironment(
  env: Pick<
    AppBindings["Bindings"],
    "DEPLOYMENT_MODE" | "LOCAL_DEV_MODE"
  >,
  hostname: string,
) {
  if (LOCAL_HOSTS.has(hostname)) return true;
  return (
    env.DEPLOYMENT_MODE === "local-primary" &&
    (env.LOCAL_DEV_MODE === true ||
      (typeof env.LOCAL_DEV_MODE === "string" &&
        ["1", "true", "yes", "on"].includes(
          env.LOCAL_DEV_MODE.trim().toLowerCase(),
        )))
  );
}

function localRateLimit(resource: "api" | "ocr" | "sync" | "notifications") {
  const config =
    resource === "api" ? LOCAL_RATE_LIMITS.api : LOCAL_RATE_LIMITS.expensive;
  const key = resource === "api" ? "api" : "expensive";
  const now = Date.now();
  const current = localRateLimitWindows.get(key);
  if (!current || now - current.windowStartedAt >= config.windowMs) {
    localRateLimitWindows.set(key, { count: 1, windowStartedAt: now });
    return { success: true as const, retryAfter: 60 };
  }

  if (current.count >= config.limit) {
    return { success: false as const, retryAfter: 60 };
  }

  current.count += 1;
  return { success: true as const, retryAfter: 60 };
}

function safeLogOrigin(value: string | undefined) {
  if (value === undefined) return null;
  if (value === "null") return "null";
  try {
    return new URL(value).origin;
  } catch {
    return "[invalid-origin]";
  }
}

function requestResource(pathname: string) {
  if (pathname.startsWith("/api/ocr/")) return "ocr";
  if (pathname.includes("/sync") || pathname.includes("/captcha"))
    return "sync";
  if (pathname.startsWith("/api/notifications/test")) return "notifications";
  return "api";
}
