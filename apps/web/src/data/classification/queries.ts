import { queryOptions } from "@tanstack/svelte-query";
import type { ApiClient } from "@/shared/api/client";
import { queryKeys } from "@/shared/api/query-keys";
import type {
  ClassificationCategoryRow,
  ClassificationMerchantsResponse,
  ClassificationRuleRow,
} from "./types";

type ApiProvider = () => ApiClient;

export const classificationRulesQuery = (getApi: ApiProvider) =>
  queryOptions({
    queryKey: queryKeys.classificationRules,
    queryFn: () =>
      getApi().get<ClassificationRuleRow[]>("/api/classification/rules"),
  });

export const classificationCategoriesQuery = (getApi: ApiProvider) =>
  queryOptions({
    queryKey: queryKeys.classificationCategories,
    queryFn: () =>
      getApi().get<ClassificationCategoryRow[]>(
        "/api/classification/categories",
      ),
  });

export const classificationMerchantsQuery = (getApi: ApiProvider) =>
  queryOptions({
    queryKey: queryKeys.classificationMerchants,
    queryFn: () =>
      getApi().get<ClassificationMerchantsResponse>(
        "/api/classification/merchants",
      ),
  });
