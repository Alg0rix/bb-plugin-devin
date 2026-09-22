import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";
import {
  experimental_recordProviderChildIo,
  withoutBridgeRuntimeEnv,
} from "@get-bb/plugin-sdk/provider-bridge";
import type { DevinThoughtLevelLadder } from "./devin-model-catalog";

export interface DevinAcpLaunchSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}

export interface DevinModelDiscovery {
  options: { value: string; name?: string }[];
  currentValue?: string;
  thoughtLevelsByModel?: Map<string, DevinThoughtLevelLadder>;
}

const acpConfigOptionValueSchema = z
  .object({
    value: z.string(),
    name: z.string().optional(),
  })
  .passthrough();

const acpConfigOptionSchema = z
  .object({
    id: z.string(),
    category: z.string().optional(),
    currentValue: z.string().optional(),
    options: z.array(acpConfigOptionValueSchema).optional(),
  })
  .passthrough();

const acpSessionNewResultSchema = z
  .object({
    sessionId: z.string(),
    configOptions: z.array(acpConfigOptionSchema).nullable().optional(),
  })
  .passthrough();

const acpConfigStateResultSchema = z
  .object({
    configOptions: z.array(acpConfigOptionSchema).nullable().optional(),
  })
  .passthrough();

const DISCOVERY_TIMEOUT_MS = 30_000;
const DISCOVERY_TTL_MS = 60_000;
const THOUGHT_LEVEL_PROBE_BUDGET_MS = 20_000;

type AcpConfigOption = z.infer<typeof acpConfigOptionSchema>;

function findThoughtLevelOption(
  options: readonly AcpConfigOption[] | undefined,
): AcpConfigOption | undefined {
  return (
    (options ?? []).find((option) => option.category === "thought_level") ??
    (options ?? []).find((option) => option.id === "thought_level")
  );
}

function toThoughtLevelLadder(
  option: AcpConfigOption | undefined,
): DevinThoughtLevelLadder {
  return {
    options: (option?.options ?? []).map((entry) => ({
      value: entry.value,
      ...(entry.name !== undefined ? { name: entry.name } : {}),
    })),
    ...(option?.currentValue !== undefined
      ? { currentValue: option.currentValue }
      : {}),
  };
}

async function probeThoughtLevels(args: {
  request: (method: string, params: unknown) => Promise<unknown>;
  sessionId: string;
  modelOption: AcpConfigOption;
  initialConfigOptions: readonly AcpConfigOption[];
}): Promise<Map<string, DevinThoughtLevelLadder>> {
  const { request, sessionId, modelOption } = args;
  const ladders = new Map<string, DevinThoughtLevelLadder>();
  if (modelOption.currentValue !== undefined) {
    ladders.set(
      modelOption.currentValue,
      toThoughtLevelLadder(
        findThoughtLevelOption(args.initialConfigOptions),
      ),
    );
  }
  const startedAt = Date.now();
  for (const option of modelOption.options ?? []) {
    if (option.value === modelOption.currentValue) {
      continue;
    }
    if (Date.now() - startedAt > THOUGHT_LEVEL_PROBE_BUDGET_MS) {
      break;
    }
    let result: unknown;
    try {
      result = await request("session/set_config_option", {
        sessionId,
        configId: modelOption.id,
        value: option.value,
      });
    } catch {
      break;
    }
    const parsed = acpConfigStateResultSchema.safeParse(result);
    const configOptions = parsed.success ? parsed.data.configOptions : undefined;
    if (configOptions === undefined || configOptions === null) {
      continue;
    }
    ladders.set(
      option.value,
      toThoughtLevelLadder(findThoughtLevelOption(configOptions)),
    );
  }
  return ladders;
}

interface CacheEntry {
  key: string;
  fetchedAt: number;
  result: DevinModelDiscovery | null;
}

let cachedDiscovery: CacheEntry | undefined;
let inFlight: { key: string; promise: Promise<DevinModelDiscovery | null> } | undefined;

function runDiscovery(
  spec: DevinAcpLaunchSpec,
  cwd: string,
): Promise<DevinModelDiscovery | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(spec.command, [...spec.args], {
        cwd: spec.cwd ?? cwd,
        env: { ...withoutBridgeRuntimeEnv(process.env), ...spec.env },
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch {
      resolve(null);
      return;
    }
    experimental_recordProviderChildIo(child, { threadId: null });

    let nextId = 0;
    let done = false;
    const pending = new Map<
      number,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >();

    const finish = (result: DevinModelDiscovery | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const entry of pending.values()) entry.reject(new Error("discovery aborted"));
      pending.clear();
      try {
        child.kill();
      } catch {
        // already exited
      }
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), DISCOVERY_TIMEOUT_MS);
    child.on("error", () => finish(null));
    child.on("exit", () => finish(null));

    const request = (method: string, params: unknown) =>
      new Promise<unknown>((resolveRequest, rejectRequest) => {
        const id = ++nextId;
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });

    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let message: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        message = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (message.id === undefined || !pending.has(message.id)) return;
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        entry?.reject(new Error(message.error.message ?? "ACP request failed"));
      } else {
        entry?.resolve(message.result);
      }
    });

    void (async () => {
      await request("initialize", {
        protocolVersion: 1,
        clientInfo: { name: "bb", version: "1.0.0" },
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: false,
        },
      });
      const session = await request("session/new", { cwd, mcpServers: [] });
      const parsed = acpSessionNewResultSchema.safeParse(session);
      if (!parsed.success) {
        finish(null);
        return;
      }
      const options = parsed.data.configOptions ?? [];
      const modelOption =
        options.find((option) => option.category === "model") ??
        options.find((option) => option.id === "model");
      if (!modelOption || (modelOption.options ?? []).length === 0) {
        finish(null);
        return;
      }
      const thoughtLevelsByModel = await probeThoughtLevels({
        request,
        sessionId: parsed.data.sessionId,
        modelOption,
        initialConfigOptions: options,
      }).catch(() => new Map<string, DevinThoughtLevelLadder>());
      finish({
        options: modelOption.options ?? [],
        currentValue: modelOption.currentValue,
        thoughtLevelsByModel,
      });
    })().catch(() => finish(null));
  });
}

export function discoverDevinModelOption(
  spec: DevinAcpLaunchSpec,
  cwd: string,
): Promise<DevinModelDiscovery | null> {
  const key = JSON.stringify({ command: spec.command, args: spec.args, cwd });
  if (
    cachedDiscovery?.key === key &&
    Date.now() - cachedDiscovery.fetchedAt < DISCOVERY_TTL_MS
  ) {
    return Promise.resolve(cachedDiscovery.result);
  }
  if (inFlight?.key === key) {
    return inFlight.promise;
  }
  const promise = runDiscovery(spec, cwd).then((result) => {
    if (result !== null) {
      cachedDiscovery = { key, fetchedAt: Date.now(), result };
    }
    if (inFlight?.promise === promise) {
      inFlight = undefined;
    }
    return result;
  });
  inFlight = { key, promise };
  return promise;
}

export function resetDevinDiscoveryCache(): void {
  cachedDiscovery = undefined;
  inFlight = undefined;
}
