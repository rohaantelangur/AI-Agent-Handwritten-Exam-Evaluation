import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { registerRoutes } from "./api/routes.js";

const config = loadConfig();
const app = Fastify({ logger });

await app.register(cors, {
  origin: false
});
await registerRoutes(app, config);

try {
  const address = await app.listen({
    port: config.port,
    host: config.host
  });

  logger.info({ address }, `Server is running on ${address}`);
} catch (error) {
  logger.error({ err: error }, "Server failed to start");
  process.exit(1);
}
