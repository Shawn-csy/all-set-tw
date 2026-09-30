import { describe, expect, it } from "vitest";
import {
  compileRulePattern,
  parseKeywordAlternation,
} from "./classification-rule-pattern";

describe("compileRulePattern", () => {
  it("combines distinct lines into one escaped regex", () => {
    const result = compileRulePattern(
      "keywords",
      "Spotify Premium Family\n(A)豆漿400ml\nspotify premium family",
    );
    expect(result).toEqual({
      operator: "regex",
      pattern: "(?:spotify premium family|\\(A\\)豆漿400ml)",
    });
    const regex = new RegExp(result!.pattern, "i");
    expect(regex.test("本月 Spotify Premium Family 訂閱")).toBe(true);
    expect(regex.test("(A)豆漿400ml")).toBe(true);
  });

  it("rejects malformed raw regex without rejecting literal keywords", () => {
    expect(compileRulePattern("regex", "[")).toBeNull();
    expect(compileRulePattern("keywords", "[")).toEqual({
      operator: "regex",
      pattern: "(?:\\[)",
    });
  });

  it("allows long keyword alternations but keeps raw expressions bounded", () => {
    expect(compileRulePattern("keywords", "A".repeat(9_996))).not.toBeNull();
    expect(compileRulePattern("keywords", "A".repeat(9_997))).toBeNull();
    expect(compileRulePattern("regex", "A".repeat(301))).toBeNull();
  });
});

describe("parseKeywordAlternation", () => {
  it("reads escaped literals back as editable keyword lines", () => {
    expect(
      parseKeywordAlternation("(?:Spotify|\\(A\\)豆漿|豆漿\\+茶)"),
    ).toEqual(["Spotify", "(A)豆漿", "豆漿+茶"]);
  });

  it("leaves general regular expressions alone", () => {
    expect(parseKeywordAlternation("(?:\\d+|[A-Z]+)")).toBeNull();
    expect(parseKeywordAlternation("\\bcoffee\\b")).toBeNull();
  });
});
