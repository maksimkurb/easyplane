import {
  CheckIcon,
  ChevronDownIcon,
  LanguagesIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  SunIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { useAuth } from "@/auth/auth-context"
import { useLanguage } from "@/components/language-provider"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Language } from "@/i18n"
import { initials } from "@/lib/initials"
import { cn } from "@/lib/utils"

const LANGUAGES: { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ru", label: "Русский" },
]

const THEMES = [
  { value: "light", labelKey: "common.themeLight", icon: SunIcon },
  { value: "dark", labelKey: "common.themeDark", icon: MoonIcon },
  { value: "system", labelKey: "common.themeSystem", icon: MonitorIcon },
] as const

/**
 * Account menu: who is signed in, language, theme and sign out.
 *
 * Destinations (networks, devices, approvals, activity) deliberately do not
 * live here — they are in the sidebar/sheet where they are always visible.
 * Two triggers are supported: the compact avatar in the phone top bar and the
 * named account button at the bottom of the desktop sidebar.
 */
export function AccountMenu({
  variant = "avatar",
  collapsed = false,
}: {
  variant?: "avatar" | "sidebar"
  /** Sidebar only: show the avatar without the name when collapsed. */
  collapsed?: boolean
}) {
  const { t } = useTranslation()
  const { me, logout } = useAuth()
  const { language, setLanguage } = useLanguage()
  const { theme, setTheme } = useTheme()

  const user = me?.user
  const label = user?.displayName || user?.email || ""

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            aria-label={t("account.menuLabel")}
            className={cn(
              "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
              variant === "avatar"
                ? "grid size-10 flex-none place-items-center rounded-full"
                : collapsed
                  ? "mx-auto grid size-10 place-items-center rounded-full"
                  : "flex w-full min-w-0 items-center gap-2.5 rounded-lg p-2 text-left hover:bg-surface-2"
            )}
            type="button"
          />
        }
      >
        {user ? (
          <span className="grid size-8 flex-none place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand-text">
            {initials(user.displayName, user.email)}
          </span>
        ) : (
          <span className="grid size-8 flex-none place-items-center rounded-full bg-surface-2 text-xs font-semibold text-fg-2">
            ?
          </span>
        )}
        {variant === "sidebar" && !collapsed ? (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">
                {label || t("account.menuLabel")}
              </span>
              {user && user.email !== label ? (
                <span className="block truncate text-[11px] text-fg-3">
                  {user.email}
                </span>
              ) : null}
            </span>
            <ChevronDownIcon
              aria-hidden="true"
              className="size-4 flex-none text-fg-3"
            />
          </>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        {user ? (
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold">{label}</p>
            {user.email !== label ? (
              <p className="truncate text-xs text-fg-3">{user.email}</p>
            ) : null}
            <p className="mt-0.5 text-xs text-fg-3">
              {t("auth.signedInAs")} · {t(`roles.${user.role}`)}
            </p>
          </div>
        ) : null}

        <MenuSeparator />
        <p className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-medium tracking-wide text-fg-3 uppercase">
          <LanguagesIcon className="size-3.5" />
          {t("common.language")}
        </p>
        {LANGUAGES.map((entry) => (
          <DropdownMenuItem
            closeOnClick={false}
            key={entry.value}
            onClick={() => setLanguage(entry.value)}
          >
            <span className="flex-1">{entry.label}</span>
            {language === entry.value ? (
              <CheckIcon className="text-brand-text" />
            ) : null}
          </DropdownMenuItem>
        ))}

        <MenuSeparator />
        <p className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-medium tracking-wide text-fg-3 uppercase">
          <PaletteIcon className="size-3.5" />
          {t("common.theme")}
        </p>
        {THEMES.map((entry) => {
          const Icon = entry.icon
          return (
            <DropdownMenuItem
              closeOnClick={false}
              key={entry.value}
              onClick={() => setTheme(entry.value)}
            >
              <Icon />
              <span className="flex-1">{t(entry.labelKey)}</span>
              {theme === entry.value ? (
                <CheckIcon className="text-brand-text" />
              ) : null}
            </DropdownMenuItem>
          )
        })}

        <MenuSeparator />
        <Button
          className="w-full justify-start text-fg-2"
          onClick={() => void logout()}
          size="sm"
          variant="ghost"
        >
          <LogOutIcon />
          {t("auth.signOut")}
        </Button>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MenuSeparator() {
  return <div aria-hidden="true" className="-mx-1.5 my-1.5 h-px bg-line" />
}
