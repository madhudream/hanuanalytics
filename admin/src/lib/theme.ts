export type Theme = "light" | "dark" | "system";

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem("hanu_theme");
    if (t === "light" || t === "dark") return t;
  } catch {
    /* ignore */
  }
  return "system";
}

export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === "system") {
    delete root.dataset.theme;
    try {
      localStorage.removeItem("hanu_theme");
    } catch {
      /* ignore */
    }
  } else {
    root.dataset.theme = t;
    try {
      localStorage.setItem("hanu_theme", t);
    } catch {
      /* ignore */
    }
  }
}

export function isDark(): boolean {
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
