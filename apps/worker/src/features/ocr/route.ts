import type { Hono } from "hono";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import { jsonError } from "../../platform/http";
import {
  MAX_OCR_BODY_BYTES,
  readRequestBodyWithLimit,
  RequestBodyTooLargeError,
} from "../../middleware/request-security";
import {
  recognizeValidateNumber,
  ValidateNumberEmptyImageError,
  ValidateNumberImageTooLargeError,
  ValidateNumberOcrError,
  ValidateNumberOcrUnavailableError,
} from "./service";

export const ocrRoutes = honoFactory.createApp();
registerOcrRoutes(ocrRoutes);

function registerOcrRoutes(api: Hono<AppBindings>) {
  api.post("/ocr/validate-number", async (c) => {
    const contentType = c.req
      .header("Content-Type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    if (!contentType || !["image/jpeg", "image/jpg"].includes(contentType)) {
      return jsonError(
        "INVALID_CONTENT_TYPE",
        "Request body must be an image/jpeg payload.",
      );
    }
    try {
      return c.json(
        await recognizeValidateNumber(
          c.env.AI,
          await readRequestBodyWithLimit(c.req.raw, MAX_OCR_BODY_BYTES),
          contentType,
        ),
      );
    } catch (error) {
      if (error instanceof ValidateNumberEmptyImageError) {
        return jsonError("EMPTY_IMAGE", "Request body must include an image.");
      }
      if (
        error instanceof ValidateNumberImageTooLargeError ||
        error instanceof RequestBodyTooLargeError
      ) {
        return jsonError(
          "IMAGE_TOO_LARGE",
          "Captcha image must be 256 KB or smaller.",
        );
      }
      if (error instanceof ValidateNumberOcrError) {
        return jsonError(
          "OCR_FAILED",
          "Could not read a 6 digit validation number.",
          422,
        );
      }
      if (error instanceof ValidateNumberOcrUnavailableError) {
        return jsonError(
          "OCR_UNAVAILABLE",
          "Gemma 4 captcha recognition is temporarily unavailable.",
          502,
        );
      }
      throw error;
    }
  });
}
