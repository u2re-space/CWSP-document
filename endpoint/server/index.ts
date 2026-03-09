import { startCoreBackend } from "./network/modules/fastify-server.ts";

startCoreBackend().catch((err: Error) => {
    console.error(err);
    process.exit(1);
});
