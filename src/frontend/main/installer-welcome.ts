import { H } from "fest/lure";
import { loadAsAdopted } from "fest/dom";
import { replaceMountContentPreservingWallpaper } from "./wallpaper-host";
import { loadSettings, saveSettings } from "@rs-com/config/Settings";
import type { AppSettings } from "@rs-com/config/SettingsTypes";

// @ts-ignore
import style from "./installer-welcome.scss?inline";

export type InstallerWelcomeResult = {
    shell: "minimal" | "environment" | "base";
    remember: boolean;
    theme: "auto" | "light" | "dark";
};

const FIRST_RUN_KEY = "rs-first-run-complete";

export const isFirstRun = (): boolean => {
    try {
        return localStorage.getItem(FIRST_RUN_KEY) !== "1";
    } catch {
        return true;
    }
};

const markFirstRunComplete = () => {
    try {
        localStorage.setItem(FIRST_RUN_KEY, "1");
    } catch {
        // ignore storage errors
    }
};

const saveBootPreferences = (result: InstallerWelcomeResult) => {
    try {
        localStorage.setItem("rs-boot-shell", result.shell);
        localStorage.setItem("rs-boot-remember", result.remember ? "1" : "0");
    } catch {
        // ignore storage errors
    }
};

const saveThemePreference = async (theme: "auto" | "light" | "dark") => {
    try {
        const settings = (await loadSettings().catch(() => ({} as AppSettings))) || {};
        const next: AppSettings = {
            ...settings,
            appearance: {
                ...(settings.appearance || {}),
                theme
            }
        };
        await saveSettings(next);
    } catch {
        // keep onboarding resilient even if settings persistence fails
    }
};

export const showInstallerWelcome = async (mountElement: HTMLElement): Promise<InstallerWelcomeResult> => {
    await loadAsAdopted(style);
    mountElement.style.backgroundImage = "url('/assets/wallpaper.jpg')";
    mountElement.style.backgroundSize = "cover";
    mountElement.style.backgroundPosition = "center";
    mountElement.style.backgroundRepeat = "no-repeat";
    return new Promise<InstallerWelcomeResult>((resolve) => {
        const root = H`<section class="installer-welcome">
            <header class="installer-welcome__header">
                <h1>Welcome to CrossWord</h1>
                <p>Quick setup for your webtop environment.</p>
            </header>

            <div class="installer-welcome__grid">
                <label class="installer-welcome__field">
                    <span>Theme</span>
                    <select data-field="theme">
                        <option value="auto">Auto</option>
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                    </select>
                </label>
            </div>

            <label class="installer-welcome__checkbox">
                <input type="checkbox" data-field="remember" checked />
                <span>Remember startup preferences</span>
            </label>

            <footer class="installer-welcome__actions">
                <button type="button" class="installer-welcome__btn installer-welcome__btn--primary" data-action="continue">Start Webtop</button>
            </footer>
        </section>` as HTMLElement;

        replaceMountContentPreservingWallpaper(mountElement, root);

        root.addEventListener("click", (event: Event) => {
            const target = event.target as HTMLElement | null;
            const action = target?.closest?.("[data-action]")?.getAttribute?.("data-action");
            if (action !== "continue") return;

            const shell: InstallerWelcomeResult["shell"] = "environment";
            const themeRaw = (root.querySelector('[data-field="theme"]') as HTMLSelectElement | null)?.value || "auto";
            const theme = (themeRaw === "light" || themeRaw === "dark" || themeRaw === "auto")
                ? themeRaw
                : "auto";
            const remember = (root.querySelector('[data-field="remember"]') as HTMLInputElement | null)?.checked !== false;

            const result: InstallerWelcomeResult = { shell, remember, theme };
            markFirstRunComplete();
            saveBootPreferences(result);
            void saveThemePreference(theme);
            resolve(result);
        });
    });
};

