import { describe, expect, it } from "vitest";
import {
  buildDevinModelCatalog,
  parseDevinVariantUid,
  resolveDevinVariantUid,
  splitDevinPrimaryModels,
  type DevinModelOptionEntry,
} from "../lib/devin-model-catalog";

const OPTIONS: DevinModelOptionEntry[] = [
  { value: "swe-2-medium", name: "SWE-2 Medium" },
  { value: "swe-2-high", name: "SWE-2 High" },
  { value: "swe-2-max", name: "SWE-2 Max" },
  { value: "swe-1-6", name: "SWE-1.6" },
  { value: "swe-1-6-fast", name: "SWE-1.6 Fast" },
  { value: "claude-opus-5-low", name: "Claude Opus 5 Low" },
  { value: "claude-opus-5-medium", name: "Claude Opus 5 Medium" },
  { value: "claude-opus-5-high", name: "Claude Opus 5 High" },
  { value: "claude-opus-5-xhigh", name: "Claude Opus 5 XHigh" },
  { value: "claude-opus-5-max", name: "Claude Opus 5 Max" },
  { value: "claude-opus-5-medium-fast", name: "Claude Opus 5 Medium Fast" },
  { value: "gpt-5-6-sol-none", name: "GPT-5.6 Sol No Thinking" },
  { value: "gpt-5-6-sol-low", name: "GPT-5.6 Sol Low" },
  { value: "gpt-5-6-sol-medium", name: "GPT-5.6 Sol Medium" },
  { value: "gemini-3-6-flash-minimal", name: "Gemini 3.6 Flash Minimal" },
  { value: "gemini-3-6-flash-medium", name: "Gemini 3.6 Flash Medium" },
  { value: "gpt-5-3-codex-high", name: "GPT-5.3 Codex High" },
  { value: "gpt-5-3-codex-high-priority", name: "GPT-5.3 Codex High Priority" },
  { value: "kimi-k2-6", name: "Kimi K2.6" },
];

describe("parseDevinVariantUid", () => {
  it("strips effort suffixes into family keys", () => {
    expect(parseDevinVariantUid("swe-2-high")).toMatchObject({
      familyKey: "swe-2",
      level: "high",
      effortToken: "high",
    });
    expect(parseDevinVariantUid("gpt-5-3-codex-xhigh")).toMatchObject({
      familyKey: "gpt-5-3-codex",
      level: "xhigh",
    });
    expect(parseDevinVariantUid("gemini-3-6-flash-minimal")).toMatchObject({
      familyKey: "gemini-3-6-flash",
      level: "low",
      effortToken: "minimal",
    });
  });

  it("detects tier suffixes before effort suffixes", () => {
    expect(parseDevinVariantUid("claude-opus-5-medium-fast")).toMatchObject({
      familyKey: "claude-opus-5",
      level: "medium",
      fast: true,
    });
    expect(parseDevinVariantUid("gpt-5-3-codex-high-priority")).toMatchObject({
      familyKey: "gpt-5-3-codex",
      level: "high",
      fast: true,
    });
    expect(parseDevinVariantUid("swe-1-6-fast")).toMatchObject({
      familyKey: "swe-1-6",
      fast: true,
    });
  });

  it("detects thinking markers without inventing levels", () => {
    const parsed = parseDevinVariantUid("claude-opus-4-6-thinking");
    expect(parsed).toMatchObject({
      familyKey: "claude-opus-4-6",
      thinking: true,
    });
    expect(parsed.level).toBeUndefined();
    expect(parseDevinVariantUid("claude-opus-4-6-thinking-1m")).toMatchObject({
      familyKey: "claude-opus-4-6-1m",
      thinking: true,
    });
  });

  it("leaves plain uids untouched", () => {
    expect(parseDevinVariantUid("kimi-k2-6")).toEqual({
      familyKey: "kimi-k2-6",
      thinking: false,
      fast: false,
    });
  });
});

describe("buildDevinModelCatalog", () => {
  const catalog = buildDevinModelCatalog(OPTIONS);

  it("groups variants into one model per family", () => {
    const ids = catalog.models.map((model) => model.id);
    expect(ids).toContain("swe-2-medium");
    expect(ids).toContain("claude-opus-5-medium");
    expect(catalog.models).toHaveLength(7);
  });

  it("exposes the full reasoning ladder per family", () => {
    const opus = catalog.models.find((m) => m.id === "claude-opus-5-medium");
    expect(
      opus?.supportedReasoningEfforts.map((effort) => effort.reasoningEffort),
    ).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(opus?.defaultReasoningEffort).toBe("medium");
  });

  it("maps minimal variants to low", () => {
    const flash = catalog.models.find((m) =>
      m.id.startsWith("gemini-3-6-flash"),
    );
    expect(
      flash?.supportedReasoningEfforts.map((effort) => effort.reasoningEffort),
    ).toEqual(["low", "medium"]);
  });

  it("marks unsuffixed families as agent-managed medium", () => {
    const kimi = catalog.models.find((m) => m.id === "kimi-k2-6");
    expect(kimi?.supportedReasoningEfforts).toEqual([
      {
        reasoningEffort: "medium",
        description: "Reasoning effort is managed by the connected ACP agent.",
      },
    ]);
  });

  it("prefers medium for the representative uid, else a non-none variant", () => {
    const sol = catalog.models.find((m) => m.id === "gpt-5-6-sol-medium");
    expect(sol?.defaultReasoningEffort).toBe("medium");
  });

  it("honors the ACP current value as the default model", () => {
    const withCurrent = buildDevinModelCatalog(OPTIONS, "swe-2-max");
    const swe = withCurrent.models.find((m) =>
      m.supportedReasoningEfforts.some((e) => e.reasoningEffort === "max"),
    );
    expect(swe?.isDefault).toBe(true);
    expect(swe?.defaultReasoningEffort).toBe("max");
    expect(withCurrent.models.filter((m) => m.isDefault)).toHaveLength(1);
  });

  it("marks a model default when no current value is given", () => {
    expect(catalog.models.filter((m) => m.isDefault)).toHaveLength(1);
  });
});

describe("resolveDevinVariantUid", () => {
  const catalog = buildDevinModelCatalog(OPTIONS);

  it("resolves family + level to the variant uid", () => {
    expect(
      resolveDevinVariantUid(catalog, {
        model: "claude-opus-5-medium",
        reasoningLevel: "xhigh",
      }),
    ).toBe("claude-opus-5-xhigh");
  });

  it("resolves the fast service tier when available", () => {
    expect(
      resolveDevinVariantUid(catalog, {
        model: "claude-opus-5-medium",
        reasoningLevel: "medium",
        serviceTier: "fast",
      }),
    ).toBe("claude-opus-5-medium-fast");
    expect(
      resolveDevinVariantUid(catalog, {
        model: "gpt-5-3-codex-high",
        reasoningLevel: "high",
        serviceTier: "fast",
      }),
    ).toBe("gpt-5-3-codex-high-priority");
  });

  it("falls back to normal tier when no fast variant exists", () => {
    expect(
      resolveDevinVariantUid(catalog, {
        model: "swe-2-medium",
        reasoningLevel: "high",
        serviceTier: "fast",
      }),
    ).toBe("swe-2-high");
  });

  it("accepts any variant uid as the family key", () => {
    expect(
      resolveDevinVariantUid(catalog, {
        model: "swe-2-max",
        reasoningLevel: "medium",
      }),
    ).toBe("swe-2-medium");
  });

  it("returns the representative uid for unknown levels and models", () => {
    expect(
      resolveDevinVariantUid(catalog, {
        model: "swe-2-medium",
        reasoningLevel: "low",
      }),
    ).toBe("swe-2-medium");
    expect(
      resolveDevinVariantUid(catalog, { model: "not-a-model" }),
    ).toBeUndefined();
  });
});

describe("splitDevinPrimaryModels", () => {
  const catalog = buildDevinModelCatalog(OPTIONS, "swe-2-medium");

  it("returns all models when no primaries are given", () => {
    const split = splitDevinPrimaryModels(catalog.models, undefined);
    expect(split.models).toHaveLength(catalog.models.length);
    expect(split.selectedOnlyModels).toHaveLength(0);
  });

  it("matches primary ids to families by variant uid", () => {
    const split = splitDevinPrimaryModels(catalog.models, [
      "claude-opus-5-max",
      "kimi-k2-6",
    ]);
    expect(split.models.map((m) => m.id)).toEqual([
      "claude-opus-5-medium",
      "kimi-k2-6",
    ]);
    expect(split.selectedOnlyModels).toHaveLength(catalog.models.length - 2);
    expect(split.models.some((m) => m.isDefault)).toBe(true);
    expect(split.selectedOnlyModels.every((m) => !m.isDefault)).toBe(true);
  });
});
