import type { ReactNode } from "react"
import { useEffect, useMemo } from "react"
import type { Decorator, Preview } from "@storybook/react-vite"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { mswLoader } from "msw-storybook-addon/csf3"
import { Router } from "wouter"
import { memoryLocation } from "wouter/memory-location"

import "@xyflow/react/dist/style.css"
import "../src/index.css"
import "../src/i18n"

import { AuthProvider } from "@/auth/auth-context"
import { LanguageProvider, useLanguage } from "@/components/language-provider"
import { ThemeProvider, useTheme } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { Language } from "@/i18n"
import { handlers } from "./mocks/handlers"

/**
 * The story toolbar mirrors the app shell:
 *  - theme uses the same ThemeProvider and `.light` / `.dark` class on <html>;
 *  - language uses the same LanguageProvider and i18next instance;
 *  - every story runs inside a QueryClient (retries off) and a memory-location
 *    wouter Router, so links, `useLocation` and `useParams` work without a URL.
 */
type StoryGlobals = {
  theme: "light" | "dark"
  locale: Language
}

const THEME_GLOBALS = [
  { value: "light", title: "Light" },
  { value: "dark", title: "Dark" },
] as const

const LOCALE_GLOBALS = [
  { value: "en", title: "English" },
  { value: "ru", title: "Русский" },
] as const

/** Applies toolbar globals to the real providers once they are mounted. */
function ToolbarSync({ theme, locale }: StoryGlobals) {
  const { setTheme } = useTheme()
  const { setLanguage } = useLanguage()

  useEffect(() => {
    setTheme(theme)
  }, [setTheme, theme])

  useEffect(() => {
    setLanguage(locale)
  }, [locale, setLanguage])

  return null
}

function StoryProviders({
  children,
  theme,
  locale,
  location,
  search,
  fullBleed,
}: StoryGlobals & {
  children: ReactNode
  location: string
  search?: string
  fullBleed: boolean
}) {
  // One client per story mount: a story never sees another story's fixtures.
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: Number.POSITIVE_INFINITY,
            refetchOnWindowFocus: false,
          },
          mutations: { retry: false },
        },
      }),
    []
  )

  const router = useMemo(
    () =>
      memoryLocation({
        path: location,
        searchPath: search,
      }),
    [location, search]
  )

  return (
    <ThemeProvider
      defaultTheme={theme}
      disableTransitionOnChange={false}
      storageKey="storybook-theme"
    >
      <LanguageProvider defaultLanguage={locale} storageKey="storybook-language">
        <ToolbarSync locale={locale} theme={theme} />
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delay={100}>
            <AuthProvider>
              <Router hook={router.hook} searchHook={router.searchHook}>
                <div
                  className={
                    fullBleed
                      ? "min-h-40 bg-background text-foreground"
                      : "min-h-40 bg-background p-6 text-foreground"
                  }
                  data-storybook-surface
                >
                  {children}
                </div>
              </Router>
            </AuthProvider>
          </TooltipProvider>
        </QueryClientProvider>
      </LanguageProvider>
    </ThemeProvider>
  )
}

const withAppShell: Decorator = (Story, context) => {
  const globals = context.globals as Partial<StoryGlobals>
  const theme = globals.theme === "dark" ? "dark" : "light"
  const locale: Language = globals.locale === "ru" ? "ru" : "en"
  const location = (context.parameters.location as string | undefined) ?? "/networks"
  const search = (context.parameters.search as string | undefined) ?? undefined
  const fullscreen = context.parameters.layout === "fullscreen"

  return (
    <StoryProviders
      fullBleed={fullscreen}
      locale={locale}
      location={location}
      search={search}
      theme={theme}
    >
      <Story />
    </StoryProviders>
  )
}

const preview: Preview = {
  tags: ["autodocs"],
  decorators: [withAppShell],
  loaders: [mswLoader()],
  globalTypes: {
    theme: {
      name: "Theme",
      description: "App theme (light / dark)",
      toolbar: {
        icon: "paintbrush",
        items: THEME_GLOBALS,
        dynamicTitle: true,
      },
    },
    locale: {
      name: "Language",
      description: "UI language (en / ru)",
      toolbar: {
        icon: "globe",
        items: LOCALE_GLOBALS,
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: "light",
    locale: "en",
  },
  parameters: {
    layout: "padded",
    msw: { handlers },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
      expanded: true,
    },
    a11y: {
      // The app is a pointer-and-keyboard product; check the WCAG A/AA rules.
      test: "error",
    },
    viewport: {
      options: {
        desktop: {
          name: "Desktop 1440",
          styles: { width: "1440px", height: "900px" },
          type: "desktop",
        },
        tablet: {
          name: "Tablet 768",
          styles: { width: "768px", height: "1024px" },
          type: "tablet",
        },
        phone: {
          name: "Phone 390",
          styles: { width: "390px", height: "844px" },
          type: "mobile",
        },
      },
    },
    options: {
      storySort: {
        order: ["UI", "Shared", "Layout", "Device", "Access", "Network", "Routes", "Topology", "Pages"],
      },
    },
  },
}

export default preview
