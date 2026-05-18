import { GoogleGenAI, Type, Schema } from "@google/genai";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

const apiKey = process.env.GEMINI_API_KEY || '';
let ai: GoogleGenAI;
if (apiKey) {
  ai = new GoogleGenAI({ apiKey });
} else {
  ai = new GoogleGenAI({});
}

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

      const responseSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          type: {
            type: Type.STRING,
            description: "The Plotly chart type (e.g., 'bar', 'line', 'scatter', 'pie'). Default to 'bar' if unsure.",
          },
          x_column: {
            type: Type.STRING,
            description: "The exact column name from the schema to map to the X-axis.",
          },
          y_column: {
            type: Type.STRING,
            description: "The exact column name from the schema to map to the Y-axis (or value column).",
          },
          group_by_column: {
            type: Type.STRING,
            description: "Optional column name for grouping/color traces. Return null if no grouping is requested.",
            nullable: true,
          },
          layout_overrides: {
            type: Type.OBJECT,
            description: "Optional Plotly-compatible layout object containing titles, themes, orientations, or axis labels based on the user's styling requests.",
            nullable: true,
          },
        },
        required: ["type", "x_column", "y_column"],
      };

      const systemInstruction = "You are a data visualization expert. Your task is to recommend a valid Plotly chart configuration based on a user's natural language request and the provided dataset schema (column names and their datatypes). Ensure that the chosen columns exist in the schema and are appropriate for the chosen chart type. For example, don't use continuous numerical data for group_by_column. Return the parameters in a strict JSON format matching the schema exactly. Ensure 'type' is a Plotly trace type string.";

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [{ text: `User request: ${prompt}\n\nDataset Schema:\n${JSON.stringify(schema, null, 2)}` }],
          },
        ],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: responseSchema,
        },
      });

      if (!response.text) {
        throw new Error("Empty response from Gemini.");
      }

      const config = JSON.parse(response.text);
      res.json(config);
    } catch (error: any) {
      console.error("Error calling Gemini API:", error);
      res.status(500).json({ error: error.message || "Failed to generate chart config." });
    }
  });

  app.post("/api/analyze-quality", async (req, res) => {
    try {
      const { metadata } = req.body;

      if (!metadata) {
        return res.status(400).json({ error: "Missing metadata in request body." });
      }

      const responseSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          recommendations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                column: { type: Type.STRING },
                issue: { type: Type.STRING },
                suggestion: { type: Type.STRING },
                action_type: { 
                  type: Type.STRING,
                  description: "Must be one of: 'drop_duplicates', 'drop_na', 'fill_na_median', 'fill_na_mean', 'fill_na_zero'"
                }
              },
              required: ["id", "column", "issue", "suggestion", "action_type"]
            }
          }
        },
        required: ["recommendations"]
      };

      const systemInstruction = "You are an expert Data Engineer. Analyze the provided dataset metadata and suggest data quality fixes. Look for missing values in columns, duplicate rows, or type anomalies. Return a structured list of actionable recommendations that can be executed via Danfo.js. If no significant issues are found, return an empty recommendations array. For 'action_type', rigidly use one of: 'drop_duplicates', 'drop_na', 'fill_na_median', 'fill_na_mean', 'fill_na_zero'.";

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [{ text: `Dataset Metadata:\n${JSON.stringify(metadata, null, 2)}` }],
          },
        ],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: responseSchema,
        },
      });

      if (!response.text) {
        throw new Error("Empty response from Gemini.");
      }

      const config = JSON.parse(response.text);
      res.json(config);
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

      const systemInstruction = `You are a Senior Data Analyst and Business Strategist. 
      Generate a comprehensive, professional data story strictly formatted in standard Markdown. 
      The report must include:
      1. **Executive Summary:** A high-level overview of what this data reveals and why it matters.
      2. **Key Drivers & Core Insights:** Bulleted, data-backed analytical deep dives into trends, correlations, or anomalies hidden in the descriptive statistics. Include actual statistical values where relevant based on the provided stats.
      3. **Data Anomalies & Integrity Note:** A professional assessment of the data quality based on the cleaning history log and null values.
      4. **Strategic Next Steps:** 3–5 concrete, highly practical business recommendations driven directly by the data findings.
      
      Never invent data not supported by the input. Your entire response must be valid Markdown.`;

      const promptData = `
        Dataset Schema: ${JSON.stringify(schema, null, 2)}
        Descriptive Statistics: ${JSON.stringify(stats, null, 2)}
        Cleaning History Log: ${JSON.stringify(cleaningHistory, null, 2)}
        Current Chart Config: ${JSON.stringify(chartConfig, null, 2)}
      `;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: [
          {
            role: "user",
            parts: [{ text: promptData }],
          },
        ],
        config: {
          systemInstruction,
        },
      });

      if (!response.text) {
        throw new Error("Empty response from Gemini.");
      }

      res.json({ report: response.text });
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
