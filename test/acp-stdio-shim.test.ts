import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SHIM = fileURLToPath(
  new URL("../lib/acp-stdio-shim.mjs", import.meta.url),
);
const FAKE_AGENT = fileURLToPath(
  new URL("./fixtures/fake-acp-agent.mjs", import.meta.url),
);

function runShim(
  respond: (shimStdin: NodeJS.WritableStream, requestLine: string) => void,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [SHIM, process.execPath, FAKE_AGENT],
      { stdio: ["pipe", "pipe", "inherit"] },
    );
    const lines: string[] = [];
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      lines.push(line);
      if (line.includes("fs/write_text_file")) {
        respond(child.stdin, line);
      }
    });
    child.on("error", reject);
    setTimeout(() => {
      child.kill();
      resolve(lines);
    }, 3000);
  });
}

describe("acp-stdio-shim", () => {
  it("forwards the agent's fs/write_text_file request upstream", async () => {
    const lines = await runShim(() => {});
    expect(
      lines.some((line) => line.includes('"fs/write_text_file"')),
    ).toBe(true);
  });

  it("rewrites result:null to {} for fs/write_text_file responses", async () => {
    const lines = await runShim((stdin) => {
      stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: null })}\n`,
      );
    });
    const echo = lines.find((line) => line.startsWith("GOT:"));
    expect(echo).toBeDefined();
    const message = JSON.parse(echo!.slice(4)) as { id: number; result: unknown };
    expect(message.result).toEqual({});
  });

  it("leaves other responses untouched", async () => {
    const lines = await runShim((stdin) => {
      stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 99, result: null })}\n`,
      );
    });
    const echo = lines.find((line) => line.startsWith("GOT:"));
    expect(echo).toBeDefined();
    const message = JSON.parse(echo!.slice(4)) as { id: number; result: unknown };
    expect(message.id).toBe(99);
    expect(message.result).toBeNull();
  });
});
