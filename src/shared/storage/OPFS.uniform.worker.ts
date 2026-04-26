/// <reference lib="webworker" />
import { registerWorkerAPI } from "fest/uniform";

// Dynamically import OPFS functionality
const initWorker = async () => {
    try {
        // Import the OPFS module dynamically
        const opfsModule = await import('fest/lure/src/extension/core/OPFS.worker.ts');

        // Get the handlers from the imported module
        const handlers = opfsModule.handlers;

        // Register all OPFS handlers with the uniform worker API
        if (handlers) {
            registerWorkerAPI(handlers);
        }

        console.log('[OPFS Worker] Initialized with handlers:', Object.keys(handlers || {}));
    } catch (error) {
        console.error('[OPFS Worker] Failed to initialize:', error);
    }
};

// Initialize the worker
initWorker();