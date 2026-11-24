import { useState } from "react"
import { useTranslation } from "react-i18next"
import { KeyRoundIcon, LogInIcon } from "lucide-react"

import { useAuth } from "@/auth/auth-context"
import { useBootstrapAdmin } from "@/api/generated/easyplane"
import { BrandMark } from "@/components/layout/brand-mark"
import { LanguageSelector } from "@/components/language-selector"
import { ThemeSelector } from "@/components/theme-selector"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/shared/field"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function LoginPage() {
  const { config, refresh } = useAuth()
  const { t } = useTranslation()
  const [showBootstrap, setShowBootstrap] = useState(false)
  const [token, setToken] = useState("")
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(() => {
    if (typeof window === "undefined") return null
    return new URLSearchParams(window.location.search).get("error")
  })

  const bootstrap = useBootstrapAdmin({
    mutation: {
      onSuccess: async () => {
        await refresh()
      },
      onError: (reason) => {
        const message =
          reason && typeof reason === "object" && "message" in reason
            ? String((reason as { message: unknown }).message)
            : t("auth.bootstrap.failed")
        setError(message)
      },
    },
  })

  const providers = config?.providers ?? []

  const startLogin = (providerId: string) => {
    window.location.assign(
      `/api/auth/login/${encodeURIComponent(providerId)}?returnTo=${encodeURIComponent(window.location.pathname)}`
    )
  }

  return (
    <main className="grid min-h-svh grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] bg-background md:h-svh md:grid-cols-[minmax(300px,38%)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)_auto] md:overflow-hidden">
      <aside
        aria-label="EasyPlane"
        className="flex min-w-0 items-center bg-brand-panel px-5 py-4 text-white md:col-start-1 md:row-start-1 md:justify-center md:p-12"
      >
        <div className="flex min-w-0 items-center gap-3 md:gap-4">
          <div
            aria-label={t("brand.logoAlt")}
            className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-white/10 p-1.5 md:size-14 md:rounded-[13px] md:p-2"
            role="img"
          >
            <BrandMark className="block size-full text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-base leading-tight font-semibold tracking-tight md:text-[22px]">
              EasyPlane
            </p>
            <p className="mt-1 text-xs text-white/80 md:mt-1.5 md:text-[13px]">
              {t("brand.tagline")}
            </p>
          </div>
        </div>
      </aside>

      <section className="flex min-w-0 items-center justify-center px-6 py-8 md:col-start-2 md:row-span-2 md:row-start-1 md:px-10 md:py-12">
        <div className="w-full max-w-100">
          <div className="mb-7">
            <h1 className="text-2xl leading-tight font-semibold tracking-tight md:text-[25px]">
              {t("auth.title")}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {t("auth.description")}
            </p>
          </div>

          <div className="space-y-3">
            {providers.length === 0 ? (
              <Alert>
                <AlertDescription>{t("auth.noProviders")}</AlertDescription>
              </Alert>
            ) : null}
            {providers.map((provider) => (
              <Button
                className="h-11 w-full justify-center"
                key={provider.id}
                onClick={() => startLogin(provider.id)}
                type="button"
              >
                <LogInIcon className="size-4" />
                {t("auth.sso", { provider: provider.label })}
              </Button>
            ))}
          </div>

          {error ? (
            <Alert className="mt-4" variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {config?.bootstrapAvailable ? (
            <div className="mt-8 border-t pt-5">
              <button
                className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                onClick={() => setShowBootstrap((value) => !value)}
                type="button"
              >
                <KeyRoundIcon className="size-4" />
                {t("auth.bootstrap.open")}
              </button>
              {showBootstrap ? (
                <form
                  className="mt-4"
                  onSubmit={(event) => {
                    event.preventDefault()
                    setError(null)
                    bootstrap.mutate({ data: { token, email } })
                  }}
                >
                  <FieldGroup className="gap-4">
                    <p className="text-sm text-muted-foreground">
                      {t("auth.bootstrap.description")}
                    </p>
                    <Field className="gap-2">
                      <FieldLabel htmlFor="bootstrap-token">
                        {t("auth.bootstrap.token")}
                      </FieldLabel>
                      <Input
                        autoComplete="off"
                        id="bootstrap-token"
                        onChange={(event) => setToken(event.target.value)}
                        required
                        type="password"
                        value={token}
                      />
                    </Field>
                    <Field className="gap-2">
                      <FieldLabel htmlFor="bootstrap-email">
                        {t("auth.bootstrap.email")}
                      </FieldLabel>
                      <Input
                        id="bootstrap-email"
                        onChange={(event) => setEmail(event.target.value)}
                        required
                        type="email"
                        value={email}
                      />
                      <FieldDescription>
                        {t("auth.bootstrap.description")}
                      </FieldDescription>
                    </Field>
                    <Button
                      disabled={bootstrap.isPending || !token || !email}
                      type="submit"
                      variant="secondary"
                    >
                      {bootstrap.isPending
                        ? t("common.loading")
                        : t("auth.bootstrap.submit")}
                    </Button>
                  </FieldGroup>
                </form>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <footer className="border-t bg-background px-5 pt-4 pb-[max(1.125rem,env(safe-area-inset-bottom))] md:col-start-1 md:row-start-2 md:border-white/10 md:bg-brand-panel md:px-6 md:pt-4.5 md:pb-5.5 md:text-white">
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 md:gap-2.5 [&_p]:text-muted-foreground md:[&_p]:text-white/80 [&_[data-slot=select-trigger]]:bg-background md:[&_[data-slot=select-trigger]]:border-white/15 md:[&_[data-slot=select-trigger]]:bg-white/5 md:[&_[data-slot=select-trigger]]:text-white">
          <LanguageSelector />
          <ThemeSelector />
        </div>
      </footer>
    </main>
  )
}
