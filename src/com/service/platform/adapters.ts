import type { ClipboardResult, ImageProcessingOptions, PlatformAdapter } from "../shared/types";
import { readText, requestCopyViaCRX, writeText } from "@rs-core/modules/Clipboard";

const showToastNotification = (
	message: string,
	options?: { type?: "info" | "success" | "warning" | "error"; duration?: number },
): void => {
	if (typeof document === "undefined") {
		console.log(message);
		return;
	}
	void import("@rs-frontend/shared/Toast")
		.then(({ showToast }) => {
			showToast({
				message,
				kind: options?.type || "info",
				duration: options?.duration || 3000,
			});
		})
		.catch(() => {
			console.log(message);
		});
};

const createPwaAdapter = (): PlatformAdapter => ({
	async copyToClipboard(data: string): Promise<ClipboardResult> {
		try {
			return (await writeText(data)) as ClipboardResult;
		} catch (e) {
			return { ok: false, error: String(e) };
		}
	},

	async readFromClipboard(): Promise<ClipboardResult> {
		try {
			return (await readText()) as ClipboardResult;
		} catch (e) {
			return { ok: false, error: String(e) };
		}
	},

	async processImage(dataUrl: string): Promise<string> {
		return dataUrl;
	},

	showNotification(
		message: string,
		options?: { type?: "info" | "success" | "warning" | "error"; duration?: number },
	): void {
		showToastNotification(message, options);
	},
});

const createCrxAdapter = (): PlatformAdapter => ({
	async copyToClipboard(data: string): Promise<ClipboardResult> {
		try {
			const result = await requestCopyViaCRX(data);
			return { ok: result.ok, data: result.data as string | undefined };
		} catch (e) {
			return { ok: false, error: String(e) as string | undefined };
		}
	},

	async readFromClipboard(): Promise<ClipboardResult> {
		try {
			return (await readText()) as ClipboardResult;
		} catch (e) {
			return { ok: false, error: String(e) };
		}
	},

	async processImage(dataUrl: string): Promise<string> {
		try {
			const isServiceWorker = typeof globalThis === "undefined" || !globalThis?.document;

			if (isServiceWorker) {
				console.warn("[RecognizeData] Image processing not available in service worker context");
				return dataUrl;
			}

			const { encodeWithJSquash, removeAnyPrefix } = await import("@rs-core/workers/ImageProcess");
			const SIZE_THRESHOLD = 2 * 1024 * 1024;
			if (dataUrl.length <= SIZE_THRESHOLD) return dataUrl;

			try {
				// @ts-ignore
				const binary = Uint8Array.fromBase64(removeAnyPrefix(dataUrl), { alphabet: "base64" });
				const blob = new Blob([binary], { type: "image/png" });
				const bitmap = await createImageBitmap(blob);
				const arrayBuffer = await encodeWithJSquash(bitmap);
				bitmap?.close?.();

				if (arrayBuffer) {
					// @ts-ignore
					const base64 = new Uint8Array(arrayBuffer).toBase64({ alphabet: "base64" });
					return `data:image/jpeg;base64,${base64}`;
				}
			} catch (processingError) {
				console.warn("[RecognizeData] Image compression failed:", processingError);
			}

			return dataUrl;
		} catch (e) {
			console.warn("[RecognizeData] Image processing failed:", e);
			return dataUrl;
		}
	},

	async captureScreenshot(rect?: {
		x: number;
		y: number;
		width: number;
		height: number;
	}): Promise<string> {
		try {
			if (typeof chrome !== "undefined" && chrome.tabs?.captureVisibleTab) {
				const captureOptions: any = { format: "png", scale: 1 };
				if (rect) {
					captureOptions.rect = rect;
				}

				return new Promise((resolve, reject) => {
					chrome.tabs.captureVisibleTab(captureOptions, (dataUrl) => {
						if (chrome.runtime.lastError) {
							reject(new Error(chrome.runtime.lastError.message));
						} else {
							resolve(dataUrl);
						}
					});
				});
			}
			throw new Error("Screenshot capture not available");
		} catch (e) {
			throw new Error(`Screenshot capture failed: ${e}`);
		}
	},

	showNotification(
		message: string,
		options?: { type?: "info" | "success" | "warning" | "error"; duration?: number },
	): void {
		console.log(`[${options?.type || "info"}] ${message}`);
	},
});

const createCoreAdapter = (): PlatformAdapter => ({
	async copyToClipboard(data: string): Promise<ClipboardResult> {
		try {
			return (await writeText(data)) as ClipboardResult;
		} catch (e) {
			return { ok: false, error: String(e) };
		}
	},

	async readFromClipboard(): Promise<ClipboardResult> {
		try {
			return (await readText()) as ClipboardResult;
		} catch (e) {
			return { ok: false, error: String(e) };
		}
	},

	showNotification(
		message: string,
		options?: { type?: "info" | "success" | "warning" | "error"; duration?: number },
	): void {
		console.log(`[${options?.type || "info"}] ${message}`);
	},
});

export const detectPlatform = (): "pwa" | "crx" | "core" | "unknown" => {
	try {
		if (typeof chrome !== "undefined" && chrome?.runtime?.id) {
			return "crx";
		}

		if (typeof self !== "undefined" && "ServiceWorkerGlobalScope" in self) {
			return "pwa";
		}

		if (typeof navigator !== "undefined" && "standalone" in navigator) {
			return "pwa";
		}

		return "core";
	} catch {
		return "unknown";
	}
};

export const getPlatformAdapter = (): PlatformAdapter => {
	const platform = detectPlatform();

	switch (platform) {
		case "crx":
			return createCrxAdapter();
		case "pwa":
			return createPwaAdapter();
		case "core":
		default:
			return createCoreAdapter();
	}
};
