import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ThemeProvider,
  useTheme,
} from "../../../../packages/shared-ui/src/components/ThemeProvider";
import { ThemeScript } from "../../../../packages/shared-ui/src/components/ThemeScript";
import { ThemeSelector } from "../../../../packages/shared-ui/src/components/ThemeSelector";
import { ThemeToggle } from "../../../../packages/shared-ui/src/components/ThemeToggle";
import {
  LEGACY_THEME_KEY,
  THEME_COOKIE_NAME,
  THEME_STORAGE_KEY,
  getTheme,
  setTheme,
  subscribeToThemeChanges,
  type Theme,
} from "../../../../packages/shared-ui/src/utils/theme";

function expireCookie(name: string): void {
  document.cookie = `${name}=; Path=/; Max-Age=0`;
}

function setCookie(name: string, value: string): void {
  document.cookie = `${name}=${value}; Path=/`;
}

function getThemeScript(nonce?: string): { nonce?: string; source: string } {
  const element = ThemeScript({ nonce });
  const props = element.props as {
    nonce?: string;
    dangerouslySetInnerHTML: { __html: string };
  };
  return { nonce: props.nonce, source: props.dangerouslySetInnerHTML.__html };
}

function executeThemeScript({
  cookie = "",
  hostname = "localhost",
  protocol = "http:",
  getStored = () => null,
  setStored = () => {},
}: {
  cookie?: string;
  hostname?: string;
  protocol?: string;
  getStored?: (name: string) => string | null;
  setStored?: (name: string, value: string) => void;
} = {}) {
  const attributes: Record<string, string> = {};
  const style: Record<string, string> = {};
  const writtenCookies: string[] = [];
  const fakeDocument = {
    get cookie() {
      return cookie;
    },
    set cookie(value: string) {
      writtenCookies.push(value);
    },
    documentElement: {
      style,
      setAttribute(name: string, value: string) {
        attributes[name] = value;
      },
    },
  };
  const fakeWindow = {
    location: { hostname, protocol },
    localStorage: { getItem: getStored, setItem: setStored },
  };

  const { source } = getThemeScript();
  Function("window", "document", source)(fakeWindow, fakeDocument);

  return { attributes, style, writtenCookies };
}

beforeEach(() => {
  expireCookie(THEME_COOKIE_NAME);
  expireCookie(LEGACY_THEME_KEY);
  window.localStorage.clear();
  document.documentElement.setAttribute("data-theme", "dark");
  document.documentElement.style.colorScheme = "";
  document.body.removeAttribute("data-theme");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("theme preference runtime", () => {
  it.each([
    ["default", "dark"],
    ["dark", "dark"],
    ["green", "dark"],
    ["light", "light"],
  ] as const)("migrates the legacy cookie value %s to %s", (legacyTheme, expectedTheme) => {
    setCookie(LEGACY_THEME_KEY, legacyTheme);

    expect(getTheme()).toBe(expectedTheme);
    expect(document.cookie).toContain(`${THEME_COOKIE_NAME}=${expectedTheme}`);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(expectedTheme);
  });

  it("migrates legacy storage when no theme cookie exists", () => {
    window.localStorage.setItem(LEGACY_THEME_KEY, "green");

    expect(getTheme()).toBe("dark");
    expect(document.cookie).toContain(`${THEME_COOKIE_NAME}=dark`);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("keeps the canonical cookie authoritative over conflicting storage", () => {
    setCookie(THEME_COOKIE_NAME, "light");
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

    expect(getTheme()).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("applies and publishes same-tab changes immediately", () => {
    const changes: Theme[] = [];
    const unsubscribe = subscribeToThemeChanges((theme) => changes.push(theme));

    setTheme("light");

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(document.body).toHaveAttribute("data-theme", "light");
    expect(changes).toEqual(["light"]);
    unsubscribe();
  });

  it("resynchronizes cookie changes on storage and browser lifecycle events", () => {
    const changes: Theme[] = [];
    const intervalSpy = vi.spyOn(window, "setInterval");
    const unsubscribe = subscribeToThemeChanges((theme) => changes.push(theme));

    setCookie(THEME_COOKIE_NAME, "light");
    window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "light" }));
    setCookie(THEME_COOKIE_NAME, "dark");
    window.dispatchEvent(new Event("focus"));
    setCookie(THEME_COOKIE_NAME, "light");
    document.dispatchEvent(new Event("visibilitychange"));
    setCookie(THEME_COOKIE_NAME, "dark");
    window.dispatchEvent(new Event("pageshow"));

    expect(changes).toEqual(["light", "dark", "light", "dark"]);
    expect(intervalSpy).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("still applies changes when localStorage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });

    expect(() => setTheme("light")).not.toThrow();
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(document.cookie).toContain(`${THEME_COOKIE_NAME}=light`);
    expect(getTheme()).toBe("light");
  });
});

describe("ThemeProvider", () => {
  function ThemeConsumer() {
    const { theme, setTheme: updateTheme, toggleTheme } = useTheme();
    return (
      <>
        <output>{theme}</output>
        <button type="button" onClick={() => updateTheme("light")}>Light</button>
        <button type="button" onClick={() => toggleTheme()}>Toggle</button>
      </>
    );
  }

  it("provides reactive set and toggle actions", () => {
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByText("dark")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(screen.getByText("light")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(screen.getByText("dark")).toBeInTheDocument();
  });
});

describe("theme controls", () => {
  it("toggles with a target-specific accessible label", () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    const lightButton = screen.getByRole("button", { name: "Switch to light mode" });
    fireEvent.click(lightButton);
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toBeInTheDocument();
  });

  it("selects explicit Dark and Light modes", () => {
    render(
      <ThemeProvider>
        <ThemeSelector />
      </ThemeProvider>,
    );

    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
});

describe("ThemeScript", () => {
  const originalCookieDomain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN;

  afterEach(() => {
    if (originalCookieDomain === undefined) delete process.env.NEXT_PUBLIC_COOKIE_DOMAIN;
    else process.env.NEXT_PUBLIC_COOKIE_DOMAIN = originalCookieDomain;
  });

  it("prepaints malformed-cookie fallback even when storage is blocked", () => {
    const result = executeThemeScript({
      cookie: `${THEME_COOKIE_NAME}=%E0%A4%A; ${LEGACY_THEME_KEY}=light`,
      getStored: () => {
        throw new DOMException("blocked");
      },
      setStored: () => {
        throw new DOMException("blocked");
      },
    });

    expect(result.attributes["data-theme"]).toBe("light");
    expect(result.style.colorScheme).toBe("light");
    expect(result.writtenCookies[0]).toContain(`${THEME_COOKIE_NAME}=light`);
  });

  it("writes a secure configured-domain cookie on deployed hosts", () => {
    process.env.NEXT_PUBLIC_COOKIE_DOMAIN = ".hypercli.com";

    const result = executeThemeScript({
      hostname: "agents.dev.hypercli.com",
      protocol: "https:",
    });

    expect(result.attributes["data-theme"]).toBe("dark");
    expect(result.writtenCookies[0]).toContain("Domain=.hypercli.com");
    expect(result.writtenCookies[0]).toContain("Secure");
  });

  it("uses a host-only cookie on localhost and supports a nonce", () => {
    process.env.NEXT_PUBLIC_COOKIE_DOMAIN = ".hypercli.com";

    const result = executeThemeScript({ hostname: "localhost", protocol: "https:" });

    expect(result.writtenCookies[0]).not.toContain("Domain=");
    expect(result.writtenCookies[0]).toContain("Secure");
    expect(getThemeScript("theme-nonce").nonce).toBe("theme-nonce");
  });
});
