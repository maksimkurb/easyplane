import path from "node:path"
import { fileURLToPath } from "node:url"

import type { StorybookConfig } from "@storybook/react-vite"

const storybookDir = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(storybookDir, "..")

/**
 * Storybook runs against the same Vite config as the app (the builder reads
 * `vite.config.ts`), so Tailwind, the `@/` alias and the React plugin behave
 * exactly like they do in `bun run dev`.
 */
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: {
    name: "@storybook/react-vite",
    options: {
      builder: { viteConfigPath: path.join(webRoot, "vite.config.ts") },
    },
  },
  // `public/` carries the logo and the MSW service worker. No backend is
  // needed: every `/api` request is answered by `.storybook/mocks/handlers.ts`.
  staticDirs: ["../public"],
  typescript: {
    reactDocgen: "react-docgen-typescript",
    reactDocgenTypescriptOptions: {
      shouldExtractLiteralValuesFromEnum: true,
      shouldRemoveUndefinedFromOptional: true,
      propFilter: (prop) =>
        prop.parent ? !/node_modules/.test(prop.parent.fileName) : true,
    },
  },
  core: { disableTelemetry: true },
}

export default config
