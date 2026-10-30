import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createBridgeIo,
  type ProviderBridgeEntry,
} from "@get-bb/plugin-sdk/provider-bridge";
import { createDevinProviderBridge } from "../host";
import { ACP_STDIO_SHIM_SOURCE } from "../lib/acp-stdio-shim-source";
import type { DevinAcpLaunchSpec } from "../lib/devin-acp-discovery";
import {
  ensureHostShim,
  localizeDevinLaunchSpec,
} from "../lib/host-launch-spec";

// What a BB server on another machine (the hub) sends to this host.
const SERVER_SPEC: DevinAcpLaunchSpec & { displayName: string } = {
  displayName: "Devin",
  command: "/usr/bin/node",
  args: [
    "/home/ubuntu/.bb/plugins/cache/git/github.com/Alg0rix/bb-plugin-devin/abc/lib/acp-stdio-shim.mjs",
    "devin",
    "acp",
  ],
  env: {},
};

const DEPS = { execPath: "/opt/host/node", ensureShim: () => "/tmp/host/acp-stdio-shim-x.mjs" };

describe("localizeDevinLaunchSpec", () => {
  it("swaps the server's node and shim paths for host-local ones", () => {
    expect(localizeDevinLaunchSpec(SERVER_SPEC, DEPS)).toEqual({
      displayName: "Devin",
      command: "/opt/host/node",
      args: ["/tmp/host/acp-stdio-shim-x.mjs", "devin", "acp"],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    });
  });

  it("leaves specs that do not launch the shim untouched", () => {
    const direct = { displayName: "Devin", command: "devin", args: ["acp"], env: {} };
    expect(localizeDevinLaunchSpec(direct, DEPS)).toBe(direct);
  });
});

describe("ensureHostShim", () => {
  it("writes the embedded shim once and reuses it", () => {
    const dir = mkdtempSync(join(tmpdir(), "devin-shim-test-"));
    try {
      const first = ensureHostShim(dir);
      expect(existsSync(first)).toBe(true);
      expect(readFileSync(first, "utf8")).toBe(ACP_STDIO_SHIM_SOURCE);
      expect(ensureHostShim(dir)).toBe(first);
      rmSync(first);
      expect(existsSync(ensureHostShim(dir))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("embeds the current lib/acp-stdio-shim.mjs (run scripts/generate-shim-source.mjs)", () => {
    const onDisk = readFileSync(new URL("../lib/acp-stdio-shim.mjs", import.meta.url), "utf8");
    expect(ACP_STDIO_SHIM_SOURCE).toBe(onDisk);
  });
});

describe("devin provider bridge on a remote host", () => {
  function harness() {
    const forwarded: string[] = [];
    const discovered: DevinAcpLaunchSpec[] = [];
    const inner: ProviderBridgeEntry = {
      experimental_apiVersion: 1,
      handleLine: (line) => forwarded.push(line),
    };
    const bridge = createDevinProviderBridge({
      inner,
      io: createBridgeIo({ write: () => {} }),
      discover: async (spec) => {
        discovered.push(spec);
        return null;
      },
      localizeLaunchSpec: (spec) => localizeDevinLaunchSpec(spec, DEPS),
    });
    return { bridge, forwarded, discovered };
  }

  async function flush(): Promise<void> {
    for (let i = 0; i < 50; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  it("discovers models with the host-local spec", async () => {
    const { bridge, discovered, forwarded } = harness();
    bridge.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "model/list",
        params: { cwd: "/repo", providerOptions: { acpLaunchSpec: SERVER_SPEC } },
      }),
    );
    await flush();
    expect(discovered[0]?.command).toBe("/opt/host/node");
    const fallback = JSON.parse(forwarded[0] ?? "{}");
    expect(fallback.params.providerOptions.acpLaunchSpec.command).toBe("/opt/host/node");
  });

  it("starts threads with the host-local spec", async () => {
    const { bridge, forwarded } = harness();
    bridge.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "thread/start",
        params: {
          cwd: "/repo",
          options: { model: "acp-default", providerOptions: { acpLaunchSpec: SERVER_SPEC } },
        },
      }),
    );
    await flush();
    const sent = JSON.parse(forwarded[0] ?? "{}");
    expect(sent.params.options.providerOptions.acpLaunchSpec.args).toEqual([
      "/tmp/host/acp-stdio-shim-x.mjs",
      "devin",
      "acp",
    ]);
  });
});
