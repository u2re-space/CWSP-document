/**
 * ShellRegistry loads this module (`import("../environment/factory")`).
 * Keep this local import symlink-safe (`shells/environment` points to this directory).
 */
import type { Shell } from "@rs-frontend/shells/types";
import { EnvironmentShell } from "./EnvironmentShell";

export function createShell(_container: HTMLElement): Shell {
    return new EnvironmentShell();
}

export default createShell;
