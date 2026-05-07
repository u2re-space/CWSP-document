import { crxFrontend } from "shells/boot";

const mount = document.getElementById("app") as HTMLElement | null;
crxFrontend(mount ?? document.body, {
    shell: "immersive",
    initialView: "settings"
});
