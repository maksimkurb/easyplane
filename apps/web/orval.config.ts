import { defineConfig } from "orval"

export default defineConfig({
  easyplane: {
    input: "../server/openapi.json",
    output: {
      target: "./src/api/generated/easyplane.ts",
      schemas: "./src/api/generated/model",
      client: "react-query",
      mode: "split",
      override: {
        mutator: {
          path: "./src/api/client.ts",
          name: "apiFetch",
        },
      },
    },
  },
})
