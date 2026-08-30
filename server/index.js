// Local dev launcher. On Vercel the same app is served from api/index.js.
import { app, ensureDb } from "./app.js";

const PORT = process.env.PORT || 4000;
ensureDb()
  .then(() => {
    console.log("MongoDB connected");
    app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  });
