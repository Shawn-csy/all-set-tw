export type RuleInputMode =
  "keywords" | "contains" | "equals" | "starts_with" | "regex";

const MAX_KEYWORD_PATTERN_LENGTH = 10_000;
const MAX_RAW_PATTERN_LENGTH = 300;

export function escapeRegexLiteral(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Read the literal alternation emitted by the keyword editor and consolidation. */
export function parseKeywordAlternation(pattern: string) {
  const text = pattern.trim();
  if (!text.startsWith("(?:") || !text.endsWith(")")) return null;
  const body = text.slice(3, -1);
  const terms: string[] = [];
  let term = "";
  for (let index = 0; index < body.length; index++) {
    const character = body[index]!;
    if (character === "\\") {
      const escaped = body[++index];
      if (!escaped || !/[.*+?^${}()|[\]\\]/u.test(escaped)) return null;
      term += escaped;
    } else if (character === "|") {
      if (!term) return null;
      terms.push(term);
      term = "";
    } else if (/[.*+?^${}()|[\]\\]/u.test(character)) {
      return null;
    } else {
      term += character;
    }
  }
  if (!term) return null;
  terms.push(term);
  return terms;
}

export function compileRulePattern(mode: RuleInputMode, value: string) {
  const text = value.trim();
  if (!text) return null;
  if (mode === "keywords") {
    const phrases = [
      ...new Map(
        text
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => [line.toLocaleLowerCase("zh-TW"), line]),
      ).values(),
    ];
    if (phrases.length === 0) return null;
    const pattern = `(?:${phrases.map(escapeRegexLiteral).join("|")})`;
    if (pattern.length > MAX_KEYWORD_PATTERN_LENGTH) return null;
    return {
      operator: "regex" as const,
      pattern,
    };
  }
  if (text.length > MAX_RAW_PATTERN_LENGTH) return null;
  if (mode === "regex") {
    try {
      new RegExp(text, "i");
    } catch {
      return null;
    }
  }
  return { operator: mode, pattern: text };
}
