import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import { connectorDefinitions } from "@/data/connectors/definitions";
import type { SyncJobRow } from "@/data/connectors/types";
import type { ApiClient } from "@/shared/api/client";
import MobileMore from "./MobileMore.svelte";

describe("MobileMore", () => {
  it("keeps unconfigured connectors in management without filling the summary", () => {
    const api = {} as ApiClient;
    const openConnector = vi.fn();
    const { getByText, queryByText } = render(MobileMore, {
      props: {
        api,
        demoMode: false,
        jobs: [],
        rules: [],
        bank: { accounts: [], transactions: [] },
        navigate: vi.fn(),
        openConnector,
      },
    });

    const connectorCount = connectorDefinitions.length;
    expect(getByText("尚未設定資料來源")).toBeInTheDocument();
    expect(
      getByText(new RegExp(`${connectorCount} 種可管理\\s*›`)),
    ).toBeInTheDocument();
    expect(getByText("同步與通知")).toBeInTheDocument();
    expect(queryByText("中國信託銀行")).not.toBeInTheDocument();
    expect(getByText("尚未設定資料來源。")).toBeInTheDocument();
  });

  it("opens the selected connector from the source summary", async () => {
    const openConnector = vi.fn();
    const { getByRole } = render(MobileMore, {
      props: {
        api: {} as ApiClient,
        demoMode: false,
        jobs: [
          {
            id: "einvoice-job",
            connectorId: "einvoice",
            configured: true,
            scope: "all",
          } as SyncJobRow,
        ],
        rules: [],
        bank: { accounts: [], transactions: [] },
        navigate: vi.fn(),
        openConnector,
      },
    });

    await fireEvent.click(getByRole("button", { name: "管理電子發票" }));

    expect(openConnector).toHaveBeenCalledWith("einvoice");
  });
});
