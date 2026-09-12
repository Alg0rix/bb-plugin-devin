import { describe, expect, it } from "vitest";
import {
  createBridgeIo,
  type ProviderBridgeEntry,
} from "@get-bb/plugin-sdk/provider-bridge";
import { createDevinProviderBridge } from "../host";
import type { DevinModelDiscovery } from "../lib/devin-acp-discovery";

const LAUNCH_SPEC = {
  displayName: "Devin",
  command: "devin",
  args: ["acp"],
  env: {},
};

const DISCOVERY: DevinModelDiscovery = {
  options: [
    { value: "swe-2-medium", name: "SWE-2 Medium" },
    { value: "swe-2-high", name: "SWE-2 High" },
    { value: "swe-2-max", name: "SWE-2 Max" },
    { value: "claude-opus-5-medium", name: "Claude Opus 5 Medium" },
    { value: "claude-opus-5-high", name: "Claude Opus 5 High" },
    { value: "claude-opus-5-medium-fast", name: "Claude Opus 5 Medium Fast" },
  ],
  currentValue: "swe-2-medium",
};

function makeHarness(discovery: DevinModelDiscovery | null = DISCOVERY) {
  const forwarded: string[] = [];
  const sent: string[] = [];
  const inner: ProviderBridgeEntry = {
    experimental_apiVersion: 1,
    handleLine: (line) => forwarded.push(line),
  };
  const io = createBridgeIo({ write: (line) => sent.push(line) });
  const bridge = createDevinProviderBridge({
    inner,
    io,
    discover: async () => discovery,
  });
  const sentMessages = () =>
    sent.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { bridge, forwarded, sentMessages };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function threadStart(model: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 7,
    method: "thread/start",
    params: {
      cwd: "/repo",
      options: {
        model,
        providerOptions: { acpLaunchSpec: LAUNCH_SPEC },
        ...extra,
      },
    },
  });
}

describe("devin provider bridge", () => {
  it("answers model/list with grouped families and reasoning ladders", async () => {
    const { bridge, forwarded, sentMessages } = makeHarness();
    bridge.handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "model/list",
        params: {
          cwd: "/repo",
          providerOptions: { acpLaunchSpec: LAUNCH_SPEC },
        },
      }),
    );
    await flush();

    expect(forwarded).toHaveLength(0);
    const response = sentMessages()[0] as {
      id: number;
      result: { models: { id: string; supportedReasoningEfforts: { reasoningEffort: string }[]; isDefault?: boolean }[] };
    };
    expect(response.id).toBe(1);
    const models = response.result.models;
    expect(models).toHaveLength(2);
    const swe = models.find((m) => m.id === "swe-2-medium");
    expect(
      swe?.supportedReasoningEfforts.map((e) => e.reasoningEffort),
    ).toEqual(["medium", "high", "max"]);
    expect(swe?.isDefault).toBe(true);
  });

  it("forwards model/list to the inner bridge when discovery fails", async () => {
    const { bridge, forwarded, sentMessages } = makeHarness(null);
    const line = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "model/list",
      params: { cwd: "/repo" },
    });
    bridge.handleLine(line);
    await flush();
    expect(forwarded).toEqual([line]);
    expect(sentMessages()).toHaveLength(0);
  });

  it("rewrites options.model to the resolved variant uid", async () => {
    const { bridge, forwarded } = makeHarness();
    bridge.handleLine(threadStart("swe-2-medium", { reasoningLevel: "max" }));
    await flush();
    const forwardedRequest = JSON.parse(forwarded[0]) as {
      params: { options: { model: string; reasoningLevel: string } };
    };
    expect(forwardedRequest.params.options.model).toBe("swe-2-max");
    expect(forwardedRequest.params.options.reasoningLevel).toBe("max");
  });

  it("rewrites to the fast variant when serviceTier is fast", async () => {
    const { bridge, forwarded } = makeHarness();
    bridge.handleLine(
      threadStart("claude-opus-5-medium", {
        reasoningLevel: "medium",
        serviceTier: "fast",
      }),
    );
    await flush();
    const forwardedRequest = JSON.parse(forwarded[0]) as {
      params: { options: { model: string } };
    };
    expect(forwardedRequest.params.options.model).toBe(
      "claude-opus-5-medium-fast",
    );
  });

  it("forwards the line unchanged when resolution is not needed", async () => {
    const { bridge, forwarded } = makeHarness();
    const line = threadStart("acp-default");
    bridge.handleLine(line);
    await flush();
    expect(forwarded).toEqual([line]);
  });

  it("passes unrelated methods and malformed lines through untouched", async () => {
    const { bridge, forwarded } = makeHarness();
    const response = JSON.stringify({ jsonrpc: "2.0", id: 9, result: {} });
    const notification = JSON.stringify({
      jsonrpc: "2.0",
      method: "thread/event",
      params: {},
    });
    bridge.handleLine(response);
    bridge.handleLine(notification);
    bridge.handleLine("not json at all");
    await flush();
    expect(forwarded).toEqual([response, notification, "not json at all"]);
  });
});
