import express, { type Request, type Application, Response, NextFunction } from "express";
// Load environment variables from .env or env in development
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

// Load standard .env first
dotenv.config({ override: true });
// Additionally load root "env" file if it exists (committed format)
(() => {
  const altEnvPath = path.resolve(process.cwd(), "env");
  if (fs.existsSync(altEnvPath)) {
    dotenv.config({ path: altEnvPath, override: true });
  }
})();
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { testGmailSMTPConnection } from './services/email';
import { createServer } from "http";

// This is for Vercel
let handler: Application | undefined = undefined;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error(err); // Log the error for debugging
    res.status(status).json({ message });
    // Do NOT throw err after sending a response in a serverless environment
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, createServer(app));
  } else {
    serveStatic(app);
  }

  // Test Gmail SMTP connection on server startup
  testGmailSMTPConnection();

  // In Vercel, we export the app and don't listen on a port
  // The Vercel runtime will handle the incoming requests.
  // This should only be defined once when not in dev.
  if (!handler) {
    handler = app;
  }

  // During development, we still listen on a port
  if (app.get("env") === "development") {
    // ALWAYS serve the app on the port specified in the environment variable PORT
    // Other ports are firewalled. Default to 5000 if not specified.
    // this serves both the API and the client.
    // It is the only port that is not firewalled.
    const port = parseInt(process.env.PORT || '5000', 10);
    const server = createServer(app);
    server.listen(port, () => {
      log(`serving on port ${port}`);
    });
  }
})();

export default async (req: Request, res: Response, next: NextFunction) => {
  if (!handler) {
    // This code will only run once on a cold start in the serverless environment
    // It initializes the Express app and registers routes.
    await registerRoutes(app);
    handler = app;
  }
  return handler(req, res, next);
};
