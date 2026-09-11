import type {
  BbPluginApi,
  PluginProviderDeclaration,
} from "@get-bb/plugin-sdk";

const acpBridgeOptions = {
  acpLaunchSpec: {
    displayName: "Devin",
    command: "devin",
    args: ["acp"],
    env: {},
  },
  acpDialect: "generic",
};

export const devinProvider = {
  id: "devin",
  displayName: "Devin",
  icon: "Bot",
  experimental_visibility: "installed",
  maintenance: {
    health: true,
  },
  experimental_bridgeOptions: acpBridgeOptions,
  capabilities: {
    supportsServiceTier: false,
    supportsNativeUserQuestion: false,
    fork: "none",
    supportsManualCompaction: false,
    supportsThreadArchive: false,
    supportsThreadRename: false,
    permissionModes: ["accept-edits", "full"],
    reasoningLevels: ["medium"],
  },
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
  },
} satisfies PluginProviderDeclaration;

export default function plugin(bb: BbPluginApi) {
  bb.providers.register(devinProvider);
}
