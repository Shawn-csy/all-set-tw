import { queryOptions } from "@tanstack/svelte-query";
import type { ApiClient } from "@/shared/api/client";
import { queryKeys } from "@/shared/api/query-keys";

export interface ReadyStatus {
  ready: boolean;
  d1: boolean;
}

type ApiProvider = () => ApiClient;

export const readyQuery = (getApi: ApiProvider) =>
  queryOptions({
    queryKey: queryKeys.ready,
    queryFn: () => getApi().get<ReadyStatus>("/api/ready"),
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: 1,
  });
