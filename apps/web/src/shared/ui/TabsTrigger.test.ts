import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import TabsTrigger from "./TabsTrigger.svelte";

describe("TabsTrigger", () => {
  it("forwards clicks to the caller", async () => {
    const onclick = vi.fn();
    const { getByRole } = render(TabsTrigger, {
      props: { active: false, onclick, children: () => "交易紀錄" },
    });

    await fireEvent.click(getByRole("tab"));

    expect(onclick).toHaveBeenCalledTimes(1);
  });
});
