// =========================
// HTTPS Credentials and Client Setup
// =========================

import path from "node:path";
import https from "node:https";
import { fileURLToPath, pathToFileURL } from "node:url";
import axios from "axios";
import config from "../../config/config.ts";
import { parsePortableInteger } from "../../lib/parsing.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function loadHttpsCredentials(): Promise<any> {
    const certFile = path.resolve(__dirname, "../../https/certificate.mjs");
    try {
        const certModule = await import(pathToFileURL(certFile).href);
        const { key, cert, ca } = certModule.default || certModule;

        if (!key || !cert) {
            throw new Error("certificate.mjs must export key and cert");
        }

        return { key, cert, ca };
    } catch (err) {
        console.error("Failed to load HTTPS certificates from https/certificate.mjs");
        throw err;
    }
}

export function createHttpClient(httpsOptions?: any) {
    const agent = httpsOptions?.ca
        ? new https.Agent({
            ca: httpsOptions.ca
        })
        : undefined;

    return axios.create({
        timeout: parsePortableInteger((config as any)?.httpTimeoutMs) ?? 3000,
        httpsAgent: agent
    });
}
