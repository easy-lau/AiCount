import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";

export type Theme = "light" | "dark" | "system";

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function readInitial(storageKey: string, defaultTheme: Theme): Theme {
  if (typeof window === "undefined") return defaultTheme;
  const stored = window.localStorage.getItem(storageKey);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return defaultTheme;
}

function applyDarkClass(theme: Theme) {
  const root = document.documentElement;
  const prefersDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", prefersDark);
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "aicount-theme",
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() =>
    readInitial(storageKey, defaultTheme),
  );

  // Persist to localStorage on change.
  useEffect(() => {
    window.localStorage.setItem(storageKey, theme);
  }, [theme, storageKey]);

  // Apply / re-apply the `.dark` class whenever the choice changes.
  useEffect(() => {
    applyDarkClass(theme);
  }, [theme]);

  // When "system" is chosen, follow OS-level changes live.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyDarkClass("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  // Sync the native Tauri window chrome (macOS / Windows title bar).
  useEffect(() => {
    let cancelled = false;
    invoke("set_window_theme", { theme }).catch((err) => {
      if (cancelled) return;
      console.debug("set_window_theme failed", err);
    });
    return () => {
      cancelled = true;
    };
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme: (next) => {
        if (next === theme) return;
        setThemeState(next);
      },
    }),
    [theme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === undefined) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
