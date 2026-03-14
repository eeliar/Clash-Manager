import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

export const THEME_OPTIONS = [
  { value: "ocean", label: "Ocean" },
  { value: "ember", label: "Ember" },
  { value: "forest", label: "Forest" },
] as const

export type AppTheme = (typeof THEME_OPTIONS)[number]["value"]

const STORAGE_KEY = "clash_theme"

const ThemeContext = createContext<{
  theme: AppTheme
  setTheme: (theme: AppTheme) => void
} | null>(null)


function readStoredTheme(): AppTheme {
  if (typeof window === "undefined") {
    return "ocean"
  }
  const storedValue = window.localStorage.getItem(STORAGE_KEY)
  if (storedValue === "ember" || storedValue === "forest" || storedValue === "ocean") {
    return storedValue
  }
  return "ocean"
}


export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<AppTheme>(() => readStoredTheme())

  useEffect(() => {
    document.documentElement.classList.add("dark")
    document.body.classList.add("theme-shell")
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}


export function useAppTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error("useAppTheme must be used within ThemeProvider")
  }
  return context
}
