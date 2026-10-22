#!/usr/bin/env node
// Stdio proxy between BB's ACP bridge and `devin acp`.
//
// BB's bridge answers agent fs/write_text_file requests with `result: null`.
// Devin's ACP client expects an empty object for that response and reports
// JSON-RPC -32700 "Parse error", marking the tool call failed even though BB
// already applied the write. This shim tracks fs/write_text_file request ids
// and rewrites their null results to {}. Remove this response workaround
// once get-bb/plugin-sdk returns {} upstream.
//
// It also renames the client in `initialize`. Devin offers only SWE-1.6 Slow
// to a client named exactly "bb"; any other name gets the account's full
// model list (SWE-2, fusion, ...).
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const CLIENT_NAME = "bb-plugin-devin";

const [command = "devin", ...commandArgs] = process.argv.slice(2);
const child = spawn(command, commandArgs.length ? commandArgs : ["acp"], {
  stdio: ["pipe", "pipe", "inherit"],
});

child.on("error", (error) => {
  console.error(`devin acp shim: failed to spawn ${command}: ${error.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});

const pendingWriteIds = new Set();

createInterface({ input: child.stdout }).on("line", (line) => {
  try {
    const message = JSON.parse(line);
    if (message?.method === "fs/write_text_file" && message.id !== undefined) {
      pendingWriteIds.add(message.id);
    }
  } catch {
    // Forward non-JSON output verbatim.
  }
  process.stdout.write(`${line}\n`);
});

createInterface({ input: process.stdin }).on("line", (line) => {
  let out = line;
  try {
    const message = JSON.parse(line);
    if (message?.method === "initialize" && message.params) {
      out = JSON.stringify({
        ...message,
        params: {
          ...message.params,
          clientInfo: { ...message.params.clientInfo, name: CLIENT_NAME },
        },
      });
    } else if (message?.id !== undefined && pendingWriteIds.delete(message.id)) {
      if ("result" in message && message.result === null) {
        out = JSON.stringify({ ...message, result: {} });
      }
    }
  } catch {
    // Forward non-JSON input verbatim.
  }
  try {
    child.stdin.write(`${out}\n`);
  } catch {
    process.exit(1);
  }
});

process.stdin.on("end", () => {
  try {
    child.stdin.end();
  } catch {
    // Child already exited.
  }
});
