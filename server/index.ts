import express from "express";
import { createServer } from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  // Serve firmware binaries from client/public — named files, real filenames
  const publicDir = path.resolve(__dirname, "..", "client", "public");

  // List available firmware binaries
  app.get("/api/firmware/list", (_req, res) => {
    if (!fs.existsSync(publicDir)) return res.json([]);
    const bins = fs.readdirSync(publicDir)
      .filter(f => f.endsWith(".bin") && !f.includes("bootloader") && !f.includes("partitions"))
      .map(f => ({
        name: f,
        size: fs.statSync(path.join(publicDir, f)).size,
        url: `/firmware/${f}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json(bins);
  });

  // Serve a specific firmware file by name
  app.get("/api/firmware/:filename", (req, res) => {
    const filename = path.basename(req.params.filename); // prevent path traversal
    const file = path.join(publicDir, filename);
    if (!fs.existsSync(file) || !filename.endsWith(".bin")) {
      return res.status(404).json({ error: "Firmware not found" });
    }
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/octet-stream");
    return res.sendFile(file);
  });

  // Legacy /api/firmware → redirects to newest non-merged, non-tft bin for backwards compat
  app.get("/api/firmware", (_req, res) => {
    if (!fs.existsSync(publicDir)) return res.status(404).json({ error: "No firmware found" });
    const bins = fs.readdirSync(publicDir)
      .filter(f => f.endsWith(".bin") && !f.includes("tft") && !f.includes("merged") && !f.includes("esp32s3_wifi_scanner"))
      .sort((a, b) => b.localeCompare(a));
    if (bins.length === 0) return res.status(404).json({ error: "No firmware found" });
    res.redirect(`/api/firmware/${bins[0]}`);
  });

  app.use(express.static(staticPath));

  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
