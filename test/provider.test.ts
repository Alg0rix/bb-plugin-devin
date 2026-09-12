import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, { devinProvider } from "../server";
import { experimental_providerBridge } from "../host";

describe("Devin provider", () => {
  it("registers the local Devin ACP launch spec", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "devin",
      experimental_hostEntry: true,
    });

    try {
      await plugin(bb);

      expect(harness.registrations.providerRegistrations).toHaveLength(1);
      expect(harness.registrations.providerRegistrations[0]).toMatchObject({
        id: "devin",
        displayName: "Devin",
        experimental_visibility: "installed",
        capabilities: {
          fork: "none",
          permissionModes: ["accept-edits", "full"],
        },
        composerActions: [],
        experimental_bridgeOptions: {
          acpDialect: "generic",
          acpLaunchSpec: {
            displayName: "Devin",
            command: process.execPath,
            args: [
              expect.stringMatching(/acp-stdio-shim\.mjs$/),
              "devin",
              "acp",
            ],
            env: {},
          },
        },
      });
    } finally {
      await harness.dispose();
    }
  });

  it("exports BB's generic ACP bridge", () => {
    expect(devinProvider.experimental_bridgeOptions?.acpDialect).toBe("generic");
    expect(experimental_providerBridge.experimental_apiVersion).toBe(1);
    expect(typeof experimental_providerBridge.handleLine).toBe("function");
  });
});
