import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { ACP_STDIO_SHIM_SOURCE } from "./acp-stdio-shim-source";
import type { DevinAcpLaunchSpec } from "./devin-acp-discovery";

// The server builds the launch spec from its own filesystem: its Node binary
// and its plugin checkout's shim path. When the BB server and the host daemon
// run on different machines (a hub plus remote hosts), neither path exists on
// the host, so every `devin acp` launch and model discovery fails and BB falls
// back to "Agent default". The host bridge rewrites such specs to the host's
// own Node binary and a host-local copy of the shim.

const SHIM_FILE_NAME = "acp-stdio-shim.mjs";

export interface LocalizeLaunchSpecDeps {
  execPath: string;
  ensureShim: () => string;
}

export function isDevinShimSpec(spec: DevinAcpLaunchSpec): boolean {
  const first = spec.args[0];
  return first !== undefined && basename(first) === SHIM_FILE_NAME;
}

export function localizeDevinLaunchSpec<T extends DevinAcpLaunchSpec>(
  spec: T,
  deps: LocalizeLaunchSpecDeps,
): T {
  if (!isDevinShimSpec(spec)) {
    return spec;
  }
  return {
    ...spec,
    command: deps.execPath,
    args: [deps.ensureShim(), ...spec.args.slice(1)],
    // The host may run under Electron (BB Desktop); without this flag its
    // binary starts the app instead of running the shim (upstream issue #1).
    env: { ...spec.env, ELECTRON_RUN_AS_NODE: "1" },
  };
}

let cachedShimPath: string | undefined;

export function ensureHostShim(dir: string = join(tmpdir(), "bb-plugin-devin")): string {
  const hash = createHash("sha256").update(ACP_STDIO_SHIM_SOURCE).digest("hex").slice(0, 12);
  const target = join(dir, `acp-stdio-shim-${hash}.mjs`);
  if (cachedShimPath === target && existsSync(target)) {
    return target;
  }
  if (!existsSync(target)) {
    mkdirSync(dir, { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    writeFileSync(temp, ACP_STDIO_SHIM_SOURCE, { mode: 0o755 });
    renameSync(temp, target);
  }
  cachedShimPath = target;
  return target;
}

export const hostLaunchSpecDeps: LocalizeLaunchSpecDeps = {
  execPath: process.execPath,
  ensureShim: () => ensureHostShim(),
};
