import crxFrontend from "../../frontend/main/crx-entry";

const mount = document.getElementById("app") as HTMLElement | null;
crxFrontend(mount ?? document.body, { initialView: "settings" });
