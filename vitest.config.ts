import { defineConfig } from "vitest/config";

export default defineConfig({
  ssr: {
    noExternal: ["@get-bb/plugin-sdk"],
  },
});
