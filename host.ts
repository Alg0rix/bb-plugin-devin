import {
  createBridgeIo,
  experimental_defineProviderBridge,
  hostDaemonAcpLaunchSpecSchema,
  type ProviderBridgeEntry,
  type ReasoningLevel,
  type ServiceTier,
} from "@get-bb/plugin-sdk/provider-bridge";
import { experimental_acpProviderBridge } from "@get-bb/plugin-sdk/provider-bridge/acp";
import {
  discoverDevinModelOption,
  type DevinAcpLaunchSpec,
  type DevinModelDiscovery,
} from "./lib/devin-acp-discovery";
import {
  buildDevinModelCatalog,
  resolveDevinVariantUid,
  splitDevinPrimaryModels,
  type DevinModelCatalog,
} from "./lib/devin-model-catalog";

type BridgeIo = ReturnType<typeof createBridgeIo>;

interface DevinBridgeDeps {
  inner: ProviderBridgeEntry;
  io: BridgeIo;
  discover: (
    spec: DevinAcpLaunchSpec,
    cwd: string,
  ) => Promise<DevinModelDiscovery | null>;
}

const SESSION_OPTIONS_METHODS = new Set([
  "thread/start",
  "thread/resume",
  "thread/fork",
]);

const ACP_DEFAULT_MODEL_ID = "acp-default";

interface JsonRpcRequestMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: {
    cwd?: string;
    providerOptions?: Record<string, unknown>;
    options?: {
      model?: string;
      serviceTier?: ServiceTier;
      reasoningLevel?: ReasoningLevel;
      providerOptions?: Record<string, unknown>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

function decodeLaunchSpec(
  providerOptions: Record<string, unknown> | undefined,
): DevinAcpLaunchSpec | null {
  const parsed = hostDaemonAcpLaunchSpecSchema.safeParse(
    providerOptions?.["acpLaunchSpec"],
  );
  return parsed.success ? parsed.data : null;
}

export function createDevinProviderBridge(deps: DevinBridgeDeps) {
  const { inner, io, discover } = deps;
  let catalog: DevinModelCatalog | null = null;
  let catalogKey: string | undefined;

  async function ensureCatalog(
    spec: DevinAcpLaunchSpec,
    cwd: string,
  ): Promise<DevinModelCatalog | null> {
    const key = JSON.stringify({ command: spec.command, args: spec.args, cwd });
    if (catalog && catalogKey === key) {
      return catalog;
    }
    const discovery = await discover(spec, cwd);
    if (!discovery) {
      return null;
    }
    catalog = buildDevinModelCatalog(
      discovery.options,
      discovery.currentValue,
      discovery.thoughtLevelsByModel,
    );
    catalogKey = key;
    return catalog;
  }

  async function handleModelList(
    request: JsonRpcRequestMessage,
    line: string,
  ): Promise<void> {
    const spec = decodeLaunchSpec(request.params?.providerOptions);
    const cwd = request.params?.cwd ?? process.cwd();
    const discovery = spec ? await discover(spec, cwd) : null;
    if (!spec || !discovery) {
      inner.handleLine(line);
      return;
    }
    const key = JSON.stringify({ command: spec.command, args: spec.args, cwd });
    let resolvedCatalog = catalog;
    if (catalogKey !== key || !resolvedCatalog) {
      resolvedCatalog = buildDevinModelCatalog(
        discovery.options,
        discovery.currentValue,
        discovery.thoughtLevelsByModel,
      );
      catalog = resolvedCatalog;
      catalogKey = key;
    }
    const primary = request.params?.providerOptions?.["primaryModels"];
    const split = splitDevinPrimaryModels(
      resolvedCatalog.models,
      Array.isArray(primary)
        ? primary.filter((entry): entry is string => typeof entry === "string")
        : undefined,
    );
    if (request.id === undefined) {
      return;
    }
    io.sendResult(request.id, split);
  }

  async function rewriteAndForward(
    request: JsonRpcRequestMessage,
    line: string,
  ): Promise<void> {
    try {
      const options = request.params?.options;
      const spec = decodeLaunchSpec(
        options?.providerOptions ?? request.params?.providerOptions,
      );
      if (
        !options ||
        !spec ||
        options.model === undefined ||
        options.model === ACP_DEFAULT_MODEL_ID
      ) {
        inner.handleLine(line);
        return;
      }
      const resolvedCatalog = await ensureCatalog(
        spec,
        request.params?.cwd ?? process.cwd(),
      );
      const resolved = resolvedCatalog
        ? resolveDevinVariantUid(resolvedCatalog, {
            model: options.model,
            reasoningLevel: options.reasoningLevel,
            serviceTier: options.serviceTier,
          })
        : undefined;
      if (resolved === undefined || resolved === options.model) {
        inner.handleLine(line);
        return;
      }
      inner.handleLine(
        JSON.stringify({
          ...request,
          params: {
            ...request.params,
            options: { ...options, model: resolved },
          },
        }),
      );
    } catch {
      inner.handleLine(line);
    }
  }

  return experimental_defineProviderBridge({
    handleLine(line) {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      let request: JsonRpcRequestMessage;
      try {
        request = JSON.parse(trimmed) as JsonRpcRequestMessage;
      } catch {
        inner.handleLine(line);
        return;
      }
      if (request.method === "model/list" && request.id !== undefined) {
        void handleModelList(request, trimmed);
        return;
      }
      if (
        request.method !== undefined &&
        SESSION_OPTIONS_METHODS.has(request.method) &&
        request.id !== undefined
      ) {
        void rewriteAndForward(request, trimmed);
        return;
      }
      inner.handleLine(line);
    },
    ...(inner.start ? { start: (ctx) => inner.start?.(ctx) } : {}),
    ...(inner.onClose ? { onClose: () => inner.onClose?.() } : {}),
    ...(inner.onSigterm ? { onSigterm: () => inner.onSigterm?.() } : {}),
    ...(inner.onSigint ? { onSigint: () => inner.onSigint?.() } : {}),
  });
}

export const experimental_providerBridge = createDevinProviderBridge({
  inner: experimental_acpProviderBridge,
  io: createBridgeIo(),
  discover: discoverDevinModelOption,
});
