import express from "express";
import cookieParser from "cookie-parser";
import adminRoutes from "./adminRoutes.js";
import routes from "./routes.js";

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use(cookieParser());
app.use("/api/admin", adminRoutes);
app.use("/api", routes);

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "ait-student-portal-api",
  });
});

app.use((_request, response) => {
  response.status(404).json({ error: "The requested API route was not found." });
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500
  ) {
    const message = error.status === 413
      ? "The request body is too large."
      : "The request could not be processed.";
    response.status(error.status).json({ error: message });
    return;
  }

  console.error("API request failed:", error);
  response.status(500).json({ error: "An unexpected server error occurred." });
});

export default app;
