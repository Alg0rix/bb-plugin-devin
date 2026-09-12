import {
  reasoningLevelValues,
  type AvailableModel,
  type ReasoningLevel,
  type ServiceTier,
} from "@get-bb/plugin-sdk/provider-bridge";

export interface DevinModelOptionEntry {
  value: string;
  name?: string;
}

export interface DevinModelVariant {
  uid: string;
  displayName: string;
  familyKey: string;
  level: ReasoningLevel;
  effortToken?: string;
  thinking: boolean;
  fast: boolean;
}

export interface DevinModelFamily {
  key: string;
  variants: DevinModelVariant[];
  byLevel: Map<ReasoningLevel, { normal?: string; fast?: string }>;
  nameByLevel: Map<ReasoningLevel, string>;
  repUid: string;
  repLevel: ReasoningLevel;
}

export interface DevinModelCatalog {
  models: AvailableModel[];
  familyByKey: Map<string, DevinModelFamily>;
  familyByVariant: Map<string, DevinModelFamily>;
}

const TIER_TAILS = ["-fast", "-priority"] as const;

const EFFORT_TOKENS: [string, ReasoningLevel][] = [
  ["extra-high", "xhigh"],
  ["ultracode", "ultracode"],
  ["minimal", "low"],
  ["medium", "medium"],
  ["xhigh", "xhigh"],
  ["ultra", "ultra"],
  ["high", "high"],
  ["none", "none"],
  ["max", "max"],
  ["low", "low"],
];

const AGENT_MANAGED_EFFORTS = [
  {
    reasoningEffort: "medium" as ReasoningLevel,
    description: "Reasoning effort is managed by the connected ACP agent.",
  },
];

const EFFORT_DISPLAY_WORDS: Record<string, string> = {
  "extra-high": "Extra High",
  ultracode: "Ultracode",
  medium: "Medium",
  xhigh: "Extra High",
  ultra: "Ultra",
  high: "High",
  none: "None",
  max: "Max",
  low: "Low",
  minimal: "Minimal",
};

const TRAILING_NOTE_PATTERN = /\s*\((?:NO ZDR|default|current)\)/gi;
const STANDALONE_WORD_PATTERN = /(^|\s)(?:1M|Thinking|Fast|XHigh)(?=\s|$)/g;

export function parseDevinVariantUid(uid: string): {
  familyKey: string;
  level?: ReasoningLevel;
  effortToken?: string;
  thinking: boolean;
  fast: boolean;
} {
  let rest = uid;
  let fast = false;
  for (const tail of TIER_TAILS) {
    if (rest.endsWith(tail)) {
      fast = true;
      rest = rest.slice(0, -tail.length);
      break;
    }
  }
  let thinking = false;
  if (rest.endsWith("-thinking")) {
    thinking = true;
    rest = rest.slice(0, -"-thinking".length);
  } else if (rest.includes("-thinking-")) {
    thinking = true;
    rest = rest.replace("-thinking-", "-");
  }
  for (const [token, level] of EFFORT_TOKENS) {
    if (rest.endsWith(`-${token}`)) {
      return {
        familyKey: rest.slice(0, -(token.length + 1)),
        level,
        effortToken: token,
        thinking,
        fast,
      };
    }
  }
  return { familyKey: rest, thinking, fast };
}

function familyDisplayName(displayName: string, effortToken?: string): string {
  const word = effortToken ? EFFORT_DISPLAY_WORDS[effortToken] : undefined;
  const stripped =
    word === undefined
      ? displayName
      : displayName.replace(new RegExp(`(^|\\s)${word}(?=\\s|$)`), "$1");
  return stripped
    .replace(TRAILING_NOTE_PATTERN, "")
    .replace(STANDALONE_WORD_PATTERN, "$1")
    .replace(/\bNo Thinking\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function buildDevinModelCatalog(
  modelOptions: readonly DevinModelOptionEntry[],
  currentValue?: string,
): DevinModelCatalog {
  const families = new Map<string, DevinModelVariant[]>();
  for (const option of modelOptions) {
    const parsed = parseDevinVariantUid(option.value);
    const variant: DevinModelVariant = {
      uid: option.value,
      displayName: option.name ?? option.value,
      familyKey: parsed.familyKey,
      level: parsed.level ?? "medium",
      effortToken: parsed.effortToken,
      thinking: parsed.thinking,
      fast: parsed.fast,
    };
    const members = families.get(parsed.familyKey) ?? [];
    members.push(variant);
    families.set(parsed.familyKey, members);
  }

  const models: AvailableModel[] = [];
  const familyByKey = new Map<string, DevinModelFamily>();
  const familyByVariant = new Map<string, DevinModelFamily>();

  for (const [key, variants] of families) {
    const hasThinking = variants.some((v) => v.thinking);
    const leveled = variants.map((variant) => {
      const level: ReasoningLevel = variant.thinking
        ? variant.level
        : hasThinking
          ? "none"
          : variant.level;
      return { variant, level };
    });

    const byLevel = new Map<ReasoningLevel, { normal?: string; fast?: string }>();
    const repEffortByCell = new Map<string, ReasoningLevel>();
    for (const { variant, level } of leveled) {
      const slot = variant.fast ? "fast" : "normal";
      const tier = byLevel.get(level) ?? {};
      const cellKey = `${level}:${slot}`;
      const upgradesNoneRep =
        level === "none" &&
        variant.level === "medium" &&
        repEffortByCell.get(cellKey) !== "medium";
      if (tier[slot] === undefined || upgradesNoneRep) {
        tier[slot] = variant.uid;
        repEffortByCell.set(cellKey, variant.level);
        byLevel.set(level, tier);
      }
    }

    const nonFast = leveled.filter((entry) => !entry.variant.fast);
    const pool = nonFast.length > 0 ? nonFast : leveled;
    const currentEntry = currentValue
      ? leveled.find((entry) => entry.variant.uid === currentValue)
      : undefined;
    const repEntry =
      currentEntry ??
      pool.find((entry) => entry.level === "medium") ??
      pool.find((entry) => entry.level !== "none") ??
      pool[0];

    const nameByLevel = new Map<ReasoningLevel, string>();
    for (const { variant, level } of leveled) {
      if (!nameByLevel.has(level)) {
        nameByLevel.set(level, variant.displayName);
      }
    }

    const levels = [...byLevel.keys()].sort(
      (a, b) => reasoningLevelValues.indexOf(a) - reasoningLevelValues.indexOf(b),
    );
    const agentManaged =
      levels.length === 1 &&
      variants.every((v) => v.effortToken === undefined && !v.thinking);

    const family: DevinModelFamily = {
      key,
      variants,
      byLevel,
      nameByLevel,
      repUid: repEntry.variant.uid,
      repLevel: repEntry.level,
    };
    familyByKey.set(key, family);
    for (const variant of variants) {
      familyByVariant.set(variant.uid, family);
    }

    models.push({
      id: repEntry.variant.uid,
      model: repEntry.variant.uid,
      displayName: familyDisplayName(
        repEntry.variant.displayName,
        repEntry.variant.effortToken,
      ),
      description: "",
      supportedReasoningEfforts: agentManaged
        ? [...AGENT_MANAGED_EFFORTS]
        : levels.map((level) => ({
            reasoningEffort: level,
            description: nameByLevel.get(level) ?? "",
          })),
      defaultReasoningEffort: repEntry.level,
      isDefault:
        currentValue !== undefined && repEntry.variant.uid === currentValue,
    });
  }

  if (!models.some((model) => model.isDefault) && models.length > 0) {
    models[0].isDefault = true;
  }
  return { models, familyByKey, familyByVariant };
}

export function resolveDevinVariantUid(
  catalog: DevinModelCatalog,
  args: {
    model: string;
    reasoningLevel?: ReasoningLevel;
    serviceTier?: ServiceTier;
  },
): string | undefined {
  const family =
    catalog.familyByVariant.get(args.model) ??
    catalog.familyByKey.get(parseDevinVariantUid(args.model).familyKey);
  if (!family) {
    return undefined;
  }
  const level = args.reasoningLevel ?? family.repLevel;
  const tier = family.byLevel.get(level);
  if (!tier) {
    return family.repUid;
  }
  if (args.serviceTier === "fast" && tier.fast !== undefined) {
    return tier.fast;
  }
  return tier.normal ?? tier.fast ?? family.repUid;
}

export function splitDevinPrimaryModels(
  catalogModels: AvailableModel[],
  primaryModels: readonly string[] | undefined,
): { models: AvailableModel[]; selectedOnlyModels: AvailableModel[] } {
  const primaryIds = new Set(primaryModels ?? []);
  if (primaryIds.size === 0) {
    return { models: [...catalogModels], selectedOnlyModels: [] };
  }
  const familyKeyOf = (id: string) => parseDevinVariantUid(id).familyKey;
  const modelsByKey = new Map(
    catalogModels.map((model) => [familyKeyOf(model.id), model]),
  );
  const modelsById = new Map(catalogModels.map((model) => [model.id, model]));
  const selected: AvailableModel[] = [];
  const seen = new Set<string>();
  for (const id of primaryIds) {
    const model = modelsById.get(id) ?? modelsByKey.get(familyKeyOf(id));
    if (model && !seen.has(model.id)) {
      seen.add(model.id);
      selected.push(model);
    }
  }
  if (selected.length === 0) {
    return { models: [...catalogModels], selectedOnlyModels: [] };
  }
  const rest = catalogModels.filter((model) => !seen.has(model.id));
  const clearDefault = (model: AvailableModel) =>
    model.isDefault ? { ...model, isDefault: false } : model;
  if (selected.some((model) => model.isDefault)) {
    return { models: selected, selectedOnlyModels: rest.map(clearDefault) };
  }
  return {
    models: selected.map((model, index) =>
      index === 0 ? { ...model, isDefault: true } : model,
    ),
    selectedOnlyModels: rest.map(clearDefault),
  };
}
