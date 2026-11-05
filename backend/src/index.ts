import "dotenv/config";
import app from "./app.js";
import { initializeDatabase, pool } from "./db.js";

const port = Number(process.env.PORT ?? 4000);

try {
  await initializeDatabase();
  const server = app.listen(port, () => {
    console.log(`Student Portal API listening on http://localhost:${port}`);
  });

  const shutdown = () => {
    server.close(() => {
      void pool.end();
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch (error) {
  console.error("Could not start the Student Portal API:", error);
  await pool.end();
  process.exitCode = 1;
}
