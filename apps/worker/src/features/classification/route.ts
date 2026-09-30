import type { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppBindings } from "../../platform/env";
import { honoFactory } from "../../platform/hono";
import { jsonError } from "../../platform/http";
import { validationHook } from "../../platform/validation";
import {
  MAX_KEYWORD_PATTERN_LENGTH,
  MAX_RAW_PATTERN_LENGTH,
  parseLiteralAlternation,
} from "./consolidation";
import {
  ClassificationCategoryExistsError,
  ClassificationCategoryInUseError,
  ClassificationCategoryNotFoundError,
  ClassificationCategoryOrderError,
  ClassificationCategorySystemError,
  ClassificationMerchantExistsError,
  ClassificationMerchantNotFoundError,
  ClassificationMerchantRuleNotFoundError,
  ClassificationRuleOrderError,
  ClassificationRuleNotFoundError,
  consolidateClassificationRules,
  createClassificationCategory,
  createClassificationMerchant,
  createClassificationMerchantProductRule,
  createClassificationMerchantRule,
  createClassificationRule,
  editClassificationMerchant,
  editClassificationCategory,
  editClassificationRule,
  getClassificationMerchants,
  getClassificationCategories,
  getClassificationRules,
  editClassificationMerchantProductRule,
  editClassificationMerchantRule,
  removeClassificationMerchantRule,
  removeClassificationCategory,
  removeClassificationOverride,
  removeClassificationRule,
  reorderClassificationRules,
  reorderClassificationCategories,
  setClassificationOverride,
} from "./service";

const targetTypeSchema = z.enum(["bank_transaction", "invoice_item"]);
const overrideParamSchema = z.object({ targetType: targetTypeSchema });
const categorySchema = z.object({ categoryId: z.string().min(1).max(64) });
const createCategorySchema = z.object({
  label: z.string().trim().min(1).max(24),
});
const reorderCategoriesSchema = z.object({
  categoryIds: z
    .array(z.string().min(1).max(64))
    .max(1_000)
    .refine((categoryIds) => new Set(categoryIds).size === categoryIds.length),
});
const createMerchantSchema = z.object({
  name: z.string().trim().min(1).max(120),
  defaultCategoryId: z.string().min(1).max(64).nullable().optional(),
});
const updateMerchantSchema = createMerchantSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0);
const merchantRuleFieldSchema = z.enum([
  "merchant_name",
  "description",
  "counterparty",
  "any_text",
  "source_id",
]);
const productRuleFieldSchema = z.enum([
  "description",
  "counterparty",
  "any_text",
  "source_id",
]);
const ruleOperatorSchema = z.enum([
  "contains",
  "equals",
  "starts_with",
  "regex",
]);
const merchantRuleSchema = z
  .object({
    targetType: targetTypeSchema.optional(),
    field: merchantRuleFieldSchema,
    operator: ruleOperatorSchema,
    pattern: z.string().min(1).max(MAX_KEYWORD_PATTERN_LENGTH),
    priority: z.number().int().min(0).max(10_000).optional(),
    description: z.string().max(500).optional(),
  })
  .refine((body) => isValidRulePattern(body.operator, body.pattern));
const productRuleSchema = z
  .object({
    categoryId: z.string().min(1).max(64),
    targetType: targetTypeSchema.optional(),
    field: productRuleFieldSchema,
    operator: ruleOperatorSchema,
    pattern: z.string().min(1).max(MAX_KEYWORD_PATTERN_LENGTH),
    priority: z.number().int().min(0).max(10_000).optional(),
    description: z.string().max(500).optional(),
  })
  .refine((body) => isValidRulePattern(body.operator, body.pattern));
const merchantRuleUpdateSchema = z
  .object({
    merchantId: z.string().min(1).max(128).optional(),
    field: merchantRuleFieldSchema.optional(),
    operator: ruleOperatorSchema.optional(),
    pattern: z.string().min(1).max(MAX_KEYWORD_PATTERN_LENGTH).optional(),
    priority: z.number().int().min(0).max(10_000).optional(),
    enabled: z.boolean().optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0)
  .refine(
    (body) =>
      body.pattern === undefined ||
      isValidRulePattern(body.operator ?? "", body.pattern),
  );
const merchantProductRuleUpdateSchema = z
  .object({
    merchantId: z.string().min(1).max(128).optional(),
    categoryId: z.string().min(1).max(64).optional(),
    field: productRuleFieldSchema.optional(),
    operator: ruleOperatorSchema.optional(),
    pattern: z.string().min(1).max(MAX_KEYWORD_PATTERN_LENGTH).optional(),
    priority: z.number().int().min(0).max(10_000).optional(),
    enabled: z.boolean().optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0)
  .refine(
    (body) =>
      body.pattern === undefined ||
      isValidRulePattern(body.operator ?? "", body.pattern),
  );
function isValidRulePattern(operator: string, pattern: string) {
  return (
    pattern.length <= MAX_RAW_PATTERN_LENGTH ||
    (pattern.length <= MAX_KEYWORD_PATTERN_LENGTH &&
      operator === "regex" &&
      parseLiteralAlternation(pattern) !== null)
  );
}
const createRuleSchema = z
  .object({
    categoryId: z.string().min(1).max(64),
    targetType: targetTypeSchema.optional(),
    field: z.enum(["any_text", "description", "counterparty", "source_id"]),
    operator: z.enum(["contains", "equals", "starts_with", "regex"]),
    pattern: z.string().min(1).max(MAX_KEYWORD_PATTERN_LENGTH),
    priority: z.number().int().min(0).max(10_000).optional(),
    description: z.string().max(500).optional(),
  })
  .refine((body) => isValidRulePattern(body.operator, body.pattern));
const updateRuleSchema = z
  .object({
    categoryId: z.string().min(1).max(64).optional(),
    operator: z.enum(["contains", "equals", "starts_with", "regex"]).optional(),
    pattern: z.string().min(1).max(MAX_KEYWORD_PATTERN_LENGTH).optional(),
    priority: z.number().int().min(0).max(10_000).optional(),
    enabled: z.boolean().optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0)
  .refine(
    (body) =>
      body.pattern === undefined ||
      isValidRulePattern(body.operator ?? "", body.pattern),
  );
const reorderRulesSchema = z.object({
  ruleIds: z
    .array(z.string().min(1).max(128))
    .max(9_000)
    .refine((ruleIds) => new Set(ruleIds).size === ruleIds.length),
});

function extractOverrideTargetId(requestPath: string, targetType: string) {
  const prefix = `/classification/overrides/${targetType}/`;
  const index = requestPath.indexOf(prefix);
  if (index < 0) return "";
  try {
    return decodeURIComponent(requestPath.slice(index + prefix.length));
  } catch {
    return "";
  }
}

export const classificationRoutes = honoFactory.createApp();
registerClassificationRoutes(classificationRoutes);

function registerClassificationRoutes(api: Hono<AppBindings>) {
  api.get("/classification/categories", async (c) =>
    c.json(await getClassificationCategories(c.env.DB)),
  );

  api.post(
    "/classification/categories",
    zValidator(
      "json",
      createCategorySchema,
      validationHook("INVALID_REQUEST", "Classification category is invalid."),
    ),
    async (c) => {
      try {
        return c.json(
          await createClassificationCategory(
            c.env.DB,
            c.req.valid("json").label,
          ),
          201,
        );
      } catch (error) {
        if (error instanceof ClassificationCategoryExistsError) {
          return jsonError(
            "CATEGORY_EXISTS",
            "A category with the same name already exists.",
            409,
          );
        }
        throw error;
      }
    },
  );

  api.put(
    "/classification/categories/order",
    zValidator(
      "json",
      reorderCategoriesSchema,
      validationHook(
        "INVALID_REQUEST",
        "Classification category order is invalid.",
      ),
    ),
    async (c) => {
      try {
        await reorderClassificationCategories(
          c.env.DB,
          c.req.valid("json").categoryIds,
        );
        return c.json({ success: true });
      } catch (error) {
        return classificationServiceError(error);
      }
    },
  );

  api.put(
    "/classification/categories/:categoryId",
    zValidator(
      "json",
      createCategorySchema,
      validationHook("INVALID_REQUEST", "Classification category is invalid."),
    ),
    async (c) => {
      try {
        return c.json(
          await editClassificationCategory(
            c.env.DB,
            c.req.param("categoryId"),
            c.req.valid("json").label,
          ),
        );
      } catch (error) {
        return classificationServiceError(error);
      }
    },
  );

  api.delete("/classification/categories/:categoryId", async (c) => {
    try {
      await removeClassificationCategory(
        c.env.DB,
        c.req.param("categoryId"),
        c.req.query("replacementCategoryId") || undefined,
      );
      return c.json({ success: true });
    } catch (error) {
      return classificationServiceError(error);
    }
  });

  api.get("/classification/merchants", async (c) =>
    c.json(await getClassificationMerchants(c.env.DB)),
  );

  api.post(
    "/classification/merchants",
    zValidator(
      "json",
      createMerchantSchema,
      validationHook("INVALID_REQUEST", "Classification merchant is invalid."),
    ),
    async (c) => {
      try {
        return c.json(
          await createClassificationMerchant(c.env.DB, c.req.valid("json")),
          201,
        );
      } catch (error) {
        return classificationServiceError(error);
      }
    },
  );

  api.put(
    "/classification/merchants/:merchantId",
    zValidator("json", updateMerchantSchema),
    async (c) => {
      try {
        const input = c.req.valid("json");
        await editClassificationMerchant(
          c.env.DB,
          c.req.param("merchantId"),
          input,
        );
        return c.json({ success: true });
      } catch (error) {
        return classificationServiceError(error);
      }
    },
  );

  api.post(
    "/classification/merchants/:merchantId/match-rules",
    zValidator(
      "json",
      merchantRuleSchema,
      validationHook("INVALID_REQUEST", "Merchant match rule is invalid."),
    ),
    async (c) => {
      try {
        return c.json(
          {
            id: await createClassificationMerchantRule(c.env.DB, {
              ...c.req.valid("json"),
              merchantId: c.req.param("merchantId"),
            }),
            success: true,
          },
          201,
        );
      } catch (error) {
        return classificationServiceError(error);
      }
    },
  );

  api.post(
    "/classification/merchants/:merchantId/product-rules",
    zValidator(
      "json",
      productRuleSchema,
      validationHook("INVALID_REQUEST", "Merchant product rule is invalid."),
    ),
    async (c) => {
      try {
        return c.json(
          {
            id: await createClassificationMerchantProductRule(c.env.DB, {
              ...c.req.valid("json"),
              merchantId: c.req.param("merchantId"),
            }),
            success: true,
          },
          201,
        );
      } catch (error) {
        return classificationServiceError(error);
      }
    },
  );

  api.put(
    "/classification/merchant-rules/:ruleId",
    zValidator("json", merchantRuleUpdateSchema),
    async (c) => {
      try {
        await editClassificationMerchantRule(
          c.env.DB,
          c.req.param("ruleId"),
          c.req.valid("json"),
        );
        return c.json({ success: true });
      } catch (error) {
        return classificationServiceError(error);
      }
    },
  );

  api.put(
    "/classification/merchant-product-rules/:ruleId",
    zValidator("json", merchantProductRuleUpdateSchema),
    async (c) => {
      try {
        await editClassificationMerchantProductRule(
          c.env.DB,
          c.req.param("ruleId"),
          c.req.valid("json"),
        );
        return c.json({ success: true });
      } catch (error) {
        return classificationServiceError(error);
      }
    },
  );

  api.delete("/classification/merchant-rules/:ruleId", async (c) => {
    try {
      await removeClassificationMerchantRule(
        c.env.DB,
        c.req.param("ruleId"),
        "merchant",
      );
      return c.json({ success: true });
    } catch (error) {
      return classificationServiceError(error);
    }
  });

  api.delete("/classification/merchant-product-rules/:ruleId", async (c) => {
    try {
      await removeClassificationMerchantRule(
        c.env.DB,
        c.req.param("ruleId"),
        "product",
      );
      return c.json({ success: true });
    } catch (error) {
      return classificationServiceError(error);
    }
  });

  api.get("/classification/rules", async (c) =>
    c.json(await getClassificationRules(c.env.DB)),
  );

  api.post("/classification/rules/consolidate", async (c) => {
    const { mergedGroups, removedRules } = await consolidateClassificationRules(
      c.env.DB,
    );
    return c.json({ mergedGroups, removedRules });
  });

  api.put(
    "/classification/rules/order",
    zValidator(
      "json",
      reorderRulesSchema,
      validationHook(
        "INVALID_REQUEST",
        "Classification rule order is invalid.",
      ),
    ),
    async (c) => {
      try {
        await reorderClassificationRules(c.env.DB, c.req.valid("json").ruleIds);
        return c.json({ success: true });
      } catch (error) {
        return classificationServiceError(error);
      }
    },
  );

  api.put(
    "/classification/overrides/:targetType/*",
    zValidator(
      "param",
      overrideParamSchema,
      validationHook("INVALID_REQUEST", "Classification override is invalid."),
    ),
    zValidator(
      "json",
      categorySchema,
      validationHook("INVALID_REQUEST", "Classification override is invalid."),
    ),
    async (c) => {
      const targetType = c.req.valid("param").targetType;
      const body = c.req.valid("json");
      const targetId = extractOverrideTargetId(c.req.path, targetType);
      if (!targetId)
        return jsonError("INVALID_REQUEST", "targetId is required.");
      await setClassificationOverride(
        c.env.DB,
        targetType,
        targetId,
        body.categoryId,
      );
      return c.json({ success: true });
    },
  );

  api.delete(
    "/classification/overrides/:targetType/*",
    zValidator(
      "param",
      overrideParamSchema,
      validationHook("INVALID_REQUEST", "targetType is not supported."),
    ),
    async (c) => {
      const targetType = c.req.valid("param").targetType;
      const targetId = extractOverrideTargetId(c.req.path, targetType);
      if (!targetId)
        return jsonError("INVALID_REQUEST", "targetId is required.");
      await removeClassificationOverride(c.env.DB, targetType, targetId);
      return c.json({ success: true });
    },
  );

  api.post(
    "/classification/rules",
    zValidator(
      "json",
      createRuleSchema,
      validationHook("INVALID_REQUEST", "Classification rule is invalid."),
    ),
    async (c) => {
      try {
        return c.json({
          id: await createClassificationRule(c.env.DB, c.req.valid("json")),
          success: true,
        });
      } catch (error) {
        return classificationServiceError(error);
      }
    },
  );

  api.put(
    "/classification/rules/:ruleId",
    zValidator(
      "json",
      updateRuleSchema,
      validationHook(
        "INVALID_REQUEST",
        "Classification rule update is invalid.",
      ),
    ),
    async (c) => {
      try {
        await editClassificationRule(
          c.env.DB,
          c.req.param("ruleId"),
          c.req.valid("json"),
        );
        return c.json({ success: true });
      } catch (error) {
        return classificationServiceError(error);
      }
    },
  );

  api.delete("/classification/rules/:ruleId", async (c) => {
    try {
      await removeClassificationRule(c.env.DB, c.req.param("ruleId"));
      return c.json({ success: true });
    } catch (error) {
      return classificationServiceError(error);
    }
  });
}

function classificationServiceError(error: unknown) {
  if (error instanceof ClassificationCategoryExistsError) {
    return jsonError(
      "CATEGORY_EXISTS",
      "A category with the same name already exists.",
      409,
    );
  }
  if (error instanceof ClassificationCategorySystemError) {
    return jsonError(
      "CATEGORY_SYSTEM",
      "System categories cannot be edited or deleted.",
      409,
    );
  }
  if (error instanceof ClassificationCategoryInUseError) {
    return jsonError(
      "CATEGORY_IN_USE",
      "This category is still in use. Choose a replacement category first.",
      409,
    );
  }
  if (error instanceof ClassificationCategoryOrderError) {
    return jsonError(
      "INVALID_REQUEST",
      "Classification category order is out of date. Reload and try again.",
      400,
    );
  }
  if (error instanceof ClassificationCategoryNotFoundError) {
    return jsonError(
      "CATEGORY_NOT_FOUND",
      "Classification category was not found.",
      404,
    );
  }
  if (error instanceof ClassificationMerchantExistsError) {
    return jsonError(
      "MERCHANT_EXISTS",
      "A merchant with the same name already exists.",
      409,
    );
  }
  if (error instanceof ClassificationMerchantNotFoundError) {
    return jsonError(
      "MERCHANT_NOT_FOUND",
      "Classification merchant was not found.",
      404,
    );
  }
  if (error instanceof ClassificationMerchantRuleNotFoundError) {
    return jsonError(
      "MERCHANT_RULE_NOT_FOUND",
      "Classification merchant rule was not found.",
      404,
    );
  }
  if (error instanceof ClassificationRuleNotFoundError) {
    return jsonError("RULE_NOT_FOUND", "Editable rule was not found.", 404);
  }
  if (error instanceof ClassificationRuleOrderError) {
    return jsonError(
      "INVALID_REQUEST",
      "Classification rule order is out of date. Reload and try again.",
      400,
    );
  }
  throw error;
}
