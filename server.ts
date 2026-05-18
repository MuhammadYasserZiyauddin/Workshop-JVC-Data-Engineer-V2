import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.post("/api/generate-chart", async (req, res) => {
    try {
      const { prompt, schema } = req.body;

      if (!prompt || !schema) {
        return res.status(400).json({ error: "Missing prompt or schema in request body." });
      }

      const stringCols = schema.filter((c: any) => c.type === 'string' || c.type === 'datetime');
      const numCols = schema.filter((c: any) => c.type === 'float32' || c.type === 'int32' || c.type === 'float64' || c.type === 'int64');

      const xCol = stringCols.length > 0 ? stringCols[0].name : "Index";
      const yCol = numCols.length > 0 ? numCols[0].name : "Index";

      res.json({
        type: "bar",
        x_column: xCol,
        y_column: yCol,
        group_by_column: null,
        layout_overrides: {
          title: "Mock AI Chart (AI Disabled)"
        }
      });
    } catch (error: any) {
      console.error("Error generating chart:", error);
      res.status(500).json({ error: error.message || "Failed to generate chart config." });
    }
  });

  app.post("/api/analyze-quality", async (req, res) => {
    try {
      const { metadata } = req.body;

      if (!metadata) {
        return res.status(400).json({ error: "Missing metadata in request body." });
      }

      res.json({ recommendations: [] });
    } catch (error: any) {
      console.error("Error analyzing quality:", error);
      res.status(500).json({ error: error.message || "Failed to analyze data quality." });
    }
  });

  app.post("/api/generate-report", async (req, res) => {
    try {
      const { schema, stats, cleaningHistory, chartConfig } = req.body;

      if (!schema || !stats) {
        return res.status(400).json({ error: "Missing schema or stats in request body." });
      }

      res.json({ 
        report: "## Executive Summary\n\nAI functionality has been disabled from the backend as requested. This is a static mock report.\n\n### Key Drivers & Insights\n- Data is processed securely on the client-side using Danfo.js.\n- No backend AI models are active, saving compute and API costs.\n\n### Strategic Next Steps\n- You can safely deploy this to Cloud Run as a standalone tool.\n- Add your own logic to the backend routes if you want customized processing." 
      });
    } catch (error: any) {
      console.error("Error generating report:", error);
      res.status(500).json({ error: error.message || "Failed to generate report." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production asset serving
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
