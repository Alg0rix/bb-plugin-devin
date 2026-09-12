// Minimal fake ACP agent for shim tests: emits an fs/write_text_file
// request, then echoes every stdin line back to stdout prefixed with GOT:.
import { createInterface } from "node:readline";

process.stdout.write(
  `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "fs/write_text_file", params: { sessionId: "s", path: "/x", content: "y" } })}\n`,
);
createInterface({ input: process.stdin }).on("line", (line) => {
  process.stdout.write(`GOT:${line}\n`);
});
setTimeout(() => process.exit(2), 10_000);
