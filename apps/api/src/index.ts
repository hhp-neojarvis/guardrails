import { serve } from "@hono/node-server";
import { app } from "./app";
import { startTokenRefreshJob } from "./jobs/meta-token-refresh.js";

const port = Number(process.env.PORT) || 3001;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
  startTokenRefreshJob();
});
