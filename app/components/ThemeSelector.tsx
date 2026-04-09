import { useState, useEffect } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useTheme, type Theme } from "~/lib/useTheme";

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function AutoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor" />
    </svg>
  );
}

const icons: Record<Theme, () => React.JSX.Element> = {
  light: SunIcon,
  dark: MoonIcon,
  auto: AutoIcon,
};

const labels: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  auto: "Auto",
};

function ChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const Icon = icons[theme];

  // Render a static placeholder during SSR to avoid Radix useId hydration mismatch
  if (!mounted) {
    return (
      <button
        className="flex cursor-pointer items-center gap-0.5 px-3 text-muted transition-colors hover:text-ink"
        aria-label="Theme"
      >
        <AutoIcon />
        <ChevronDown />
      </button>
    );
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex cursor-pointer items-center gap-0.5 px-3 text-muted transition-colors hover:text-ink"
          aria-label="Theme"
        >
          <Icon />
          <ChevronDown />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-28 border border-border bg-paper py-1"
          align="end"
          sideOffset={4}
        >
          {(["light", "dark", "auto"] as Theme[]).map((t) => {
            const ItemIcon = icons[t];
            return (
              <DropdownMenu.Item
                key={t}
                onSelect={() => setTheme(t)}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm outline-none data-[highlighted]:bg-border"
              >
                <ItemIcon />
                <span>{labels[t]}</span>
                {theme === t && <span className="ml-auto text-muted">{"\u2713"}</span>}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
