import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  discoverDevinModelOption,
  resetDevinDiscoveryCache,
} from "../lib/devin-acp-discovery";

const FAKE_AGENT = fileURLToPath(
  new URL("./fixtures/fake-devin-acp.mjs", import.meta.url),
);

const SPEC = {
  command: process.execPath,
  args: [FAKE_AGENT],
  env: {},
};

describe("discoverDevinModelOption", () => {
  it("probes the thought_level ladder of every model", async () => {
    resetDevinDiscoveryCache();
    const discovery = await discoverDevinModelOption(SPEC, process.cwd());
    expect(discovery?.options.map((o) => o.value)).toEqual([
      "swe-2-high",
      "glm-5-2",
      "kimi-k2-6",
    ]);
    expect(discovery?.currentValue).toBe("swe-2-high");
    expect(
      discovery?.thoughtLevelsByModel
        ?.get("swe-2-high")
        ?.options.map((o) => o.value),
    ).toEqual(["medium", "high", "max"]);
    expect(
      discovery?.thoughtLevelsByModel
        ?.get("glm-5-2")
        ?.options.map((o) => o.value),
    ).toEqual(["none", "high", "max"]);
    // kimi-k2-6 was probed and reported no thought_level selector.
    expect(discovery?.thoughtLevelsByModel?.get("kimi-k2-6")).toEqual({
      options: [],
    });
  });
});
