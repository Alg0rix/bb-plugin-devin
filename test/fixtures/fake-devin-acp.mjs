// Fake Devin ACP agent for discovery tests: answers initialize, session/new,
// and session/set_config_option with per-model thought_level ladders.
import { createInterface } from "node:readline";

const MODELS = ["swe-2-high", "glm-5-2", "kimi-k2-6"];
const LADDERS = {
  "swe-2-high": ["medium", "high", "max"],
  "glm-5-2": ["none", "high", "max"],
  "kimi-k2-6": null,
};

let current = "swe-2-high";

function configOptionsFor(model) {
  const options = [
    {
      id: "model",
      category: "model",
      type: "select",
      currentValue: model,
      options: MODELS.map((value) => ({ value })),
    },
  ];
  const ladder = LADDERS[model];
  if (ladder) {
    options.push({
      id: "thought_level",
      category: "thought_level",
      type: "select",
      currentValue: ladder[ladder.length - 1],
      options: ladder.map((value) => ({ value, name: value })),
    });
  }
  return options;
}

createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return;
  const respond = (result) =>
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`,
    );
  if (message.method === "initialize") {
    return respond({ protocolVersion: 1 });
  }
  if (message.method === "session/new") {
    return respond({
      sessionId: "s1",
      configOptions: configOptionsFor(current),
    });
  }
  if (message.method === "session/set_config_option") {
    if (message.params?.configId === "model") {
      current = message.params.value;
    }
    return respond({ configOptions: configOptionsFor(current) });
  }
  respond({});
});

setTimeout(() => process.exit(0), 20_000);
