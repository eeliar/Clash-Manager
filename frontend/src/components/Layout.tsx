import { NavLink, Outlet } from "react-router-dom"
import {
  Boxes,
  Cable,
  FileCode2,
  LayoutDashboard,
  Network,
  ScrollText,
  Shield,
} from "lucide-react"
import { THEME_OPTIONS, useAppTheme } from "@/components/ThemeProvider"
import { APP_VERSION } from "@/lib/version"

export function Layout() {
  const { theme, setTheme } = useAppTheme()
  const primaryItems = [
    { to: "/", icon: LayoutDashboard, label: "Overview" },
    { to: "/profiles", icon: Shield, label: "Profiles" },
    { to: "/devices", icon: Cable, label: "Devices" },
  ]

  const editorItems = [
    { to: "/proxies", icon: Network, label: "Proxies" },
    { to: "/groups", icon: Boxes, label: "Groups" },
    { to: "/rules", icon: ScrollText, label: "Rules" },
    { to: "/config", icon: FileCode2, label: "Config" },
  ]

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="relative min-h-screen overflow-hidden">
        <div className="theme-shell-overlay pointer-events-none absolute inset-0" />
        <div className="relative mx-auto flex min-h-screen max-w-[1600px] flex-col lg:flex-row">
          <aside className="border-b border-white/10 bg-[#08111bd6] px-4 py-4 backdrop-blur lg:min-h-screen lg:w-[320px] lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
            <div className="flex items-center justify-between gap-4 lg:flex-col lg:items-stretch">
              <div className="flex items-center gap-4">
                <div className="theme-accent-frame rounded-3xl border p-3 shadow-lg">
                  <Shield className="size-7" />
                </div>
                <div>
                  <div className="text-lg font-semibold tracking-tight text-white">
                    ClashManager
                  </div>
                  <div className="text-xs uppercase tracking-[0.28em] text-slate-400">
                    Release Studio
                  </div>
                </div>
              </div>
              <div className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-slate-300 lg:inline-flex">
                Config shipping
              </div>
            </div>

            <div className="mt-6 rounded-[28px] border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              Publish revisions, hand out device links, and keep the raw proxy editor off the critical path.
            </div>

            <nav className="mt-6 space-y-6">
              <div>
                <div className="mb-3 px-3 text-[11px] uppercase tracking-[0.24em] text-slate-500">
                  Control
                </div>
                <div className="space-y-2">
                  {primaryItems.map((item) => {
                    const Icon = item.icon
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.to === "/"}
                        className={({ isActive }) =>
                          `group flex items-center justify-between rounded-2xl border px-4 py-3 transition ${
                            isActive
                              ? "theme-accent-active text-white"
                              : "border-transparent bg-transparent text-slate-300 hover:border-white/10 hover:bg-white/5 hover:text-white"
                          }`
                        }
                      >
                        <span className="flex items-center gap-3">
                          <Icon className="size-4" />
                          <span className="font-medium">{item.label}</span>
                        </span>
                        <span className="text-xs uppercase tracking-[0.24em] text-slate-500 transition group-hover:text-slate-300">
                          open
                        </span>
                      </NavLink>
                    )
                  })}
                </div>
              </div>

              <div>
                <div className="mb-3 px-3 text-[11px] uppercase tracking-[0.24em] text-slate-500">
                  Builder
                </div>
                <div className="space-y-2">
                  {editorItems.map((item) => {
                    const Icon = item.icon
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) =>
                          `flex items-center gap-3 rounded-2xl border px-4 py-3 transition ${
                            isActive
                              ? "theme-accent-active text-white"
                              : "border-transparent text-slate-400 hover:border-white/10 hover:bg-white/4 hover:text-slate-200"
                          }`
                        }
                      >
                        <Icon className="size-4" />
                        <span>{item.label}</span>
                      </NavLink>
                    )
                  })}
                </div>
              </div>
            </nav>

            <div className="mt-8 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-[11px] uppercase tracking-[0.24em] text-slate-400">
              v{APP_VERSION}
            </div>
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-white">
              <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">
                Theme Preset
              </div>
              <select
                value={theme}
                onChange={(event) => setTheme(event.target.value as typeof theme)}
                className="mt-3 h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white outline-none"
              >
                {THEME_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value} className="bg-slate-950">
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </aside>

          <main className="flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>

        <div className="pointer-events-none absolute bottom-4 right-4 rounded-full border border-white/10 bg-[#08111bd6] px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-slate-300 backdrop-blur">
          Dashboard v{APP_VERSION}
        </div>
      </div>
    </div>
  )
}
