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
