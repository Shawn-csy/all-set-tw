import { describe, expect, it } from "vitest";
import { parseViewHash, viewHash } from "./navigation";
import { navItems, workspaceTabs } from "./navigation-config";

describe("view hash navigation", () => {
  it("parses supported hash routes", () => {
    expect(parseViewHash("#/assets")).toBe("assets");
    expect(parseViewHash("#/purchases")).toBe("purchases");
    expect(parseViewHash("#/investment-returns")).toBe("investment-returns");
    expect(parseViewHash("#classification-rules")).toBe("classification-rules");
    expect(parseViewHash("#/sync-notifications")).toBe("sync-notifications");
    expect(parseViewHash("#/ai-export")).toBe("ai-export");
  });

  it("rejects unknown routes and formats valid views", () => {
    expect(parseViewHash("#/unknown")).toBeNull();
    expect(parseViewHash("#/invoices")).toBeNull();
    expect(viewHash("manual-assets")).toBe("#/manual-assets");
  });

  it("keeps the desktop sidebar at workspace level", () => {
    expect(navItems.map((item) => item.label)).toEqual([
      "首頁",
      "帳務",
      "資產",
      "設定",
    ]);
  });

  it("keeps detail pages inside their workspace", () => {
    expect(workspaceTabs.activity?.map((tab) => tab.label)).toEqual([
      "支出分析",
      "資金流",
      "購買品項",
    ]);
    expect(workspaceTabs.assets?.map((tab) => tab.label)).toEqual([
      "資產清冊",
      "投資收益",
    ]);
    expect(workspaceTabs.settings?.map((tab) => tab.label)).toEqual([
      "設定總覽",
      "資料來源",
      "同步與通知",
      "匯率",
      "分類規則",
      "AI 匯出",
    ]);
  });
});
