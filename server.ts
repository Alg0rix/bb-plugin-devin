import { fileURLToPath } from "node:url";
import type {
  BbPluginApi,
  PluginProviderDeclaration,
} from "@get-bb/plugin-sdk";

// BB's ACP bridge answers fs/write_text_file with `result: null`, which
// Devin's ACP client rejects with a -32700 parse error (the write still
// lands, but the tool call renders as failed). Route launches through the
// stdio shim, which rewrites those responses to `result: {}`.
const acpShimPath = fileURLToPath(
  new URL("../lib/acp-stdio-shim.mjs", import.meta.url),
);

const acpBridgeOptions = {
  acpLaunchSpec: {
    displayName: "Devin",
    command: process.execPath,
    args: [acpShimPath, "devin", "acp"],
    env: {},
  },
  acpDialect: "generic",
};

export const devinProvider = {
  id: "devin",
  displayName: "Devin",
  icon: "./icons/devin.svg",
  experimental_visibility: "installed",
  maintenance: {
    health: true,
  },
  experimental_bridgeOptions: acpBridgeOptions,
  capabilities: {
    supportsServiceTier: true,
    supportsNativeUserQuestion: false,
    fork: "none",
    supportsManualCompaction: false,
    supportsThreadArchive: false,
    supportsThreadRename: false,
    permissionModes: ["accept-edits", "full"],
    reasoningLevels: ["none", "low", "medium", "high", "xhigh", "max"],
  },
  reasoningLevels: [
    { id: "none", label: "None" },
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium" },
    { id: "high", label: "High" },
    { id: "xhigh", label: "Extra High" },
    { id: "max", label: "Max" },
  ],
  serviceTiers: [{ id: "fast", label: "Fast" }],
  composerActions: [],
  strings: {
    signInHint:
      "Run `devin auth login` on the machine running this BB host.",
    expiredHint:
      "Run `devin auth login` on the machine running this BB host, then reload the provider.",
    installUrl: "https://docs.devin.ai/cli/index",
    brandPrefix: "Devin ",
  },
  models: {
    scope: "host",
    fallback: [
      {
        id: "swe-2-high",
        displayName: "SWE-2",
        description: "Cognition's coding model.",
        supportedReasoningEfforts: [
          { reasoningEffort: "medium", description: "SWE-2 Medium" },
          { reasoningEffort: "high", description: "SWE-2 High" },
          { reasoningEffort: "max", description: "SWE-2 Max" },
        ],
        defaultReasoningEffort: "high",
        isDefault: true,
      },
      {
        id: "claude-opus-5-medium",
        displayName: "Claude Opus 5",
        description: "Anthropic's frontier model.",
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "Claude Opus 5 Low" },
          { reasoningEffort: "medium", description: "Claude Opus 5 Medium" },
          { reasoningEffort: "high", description: "Claude Opus 5 High" },
          { reasoningEffort: "xhigh", description: "Claude Opus 5 XHigh" },
          { reasoningEffort: "max", description: "Claude Opus 5 Max" },
        ],
        defaultReasoningEffort: "medium",
        isDefault: false,
      },
      {
        id: "gpt-5-6-sol-medium",
        displayName: "GPT-5.6 Sol",
        description: "OpenAI's frontier model.",
        supportedReasoningEfforts: [
          { reasoningEffort: "none", description: "GPT-5.6 Sol No Thinking" },
          { reasoningEffort: "low", description: "GPT-5.6 Sol Low Thinking" },
          { reasoningEffort: "medium", description: "GPT-5.6 Sol Medium Thinking" },
          { reasoningEffort: "high", description: "GPT-5.6 Sol High Thinking" },
          { reasoningEffort: "xhigh", description: "GPT-5.6 Sol XHigh Thinking" },
          { reasoningEffort: "max", description: "GPT-5.6 Sol Max Thinking" },
        ],
        defaultReasoningEffort: "medium",
        isDefault: false,
      },
    ],
  },
} satisfies PluginProviderDeclaration;

export default function plugin(bb: BbPluginApi) {
  bb.providers.register(devinProvider);
}
