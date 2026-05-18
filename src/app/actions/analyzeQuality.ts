"use server";

import { GoogleGenAI, Type, Schema } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenAI(apiKey ? { apiKey } : {});

export async function analyzeQualityAction(metadata: any) {
  if (!metadata) {
    throw new Error("Missing metadata.");
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

  const systemInstruction = "You are an expert Data Engineer. Analyze the provided dataset metadata and suggest data quality fixes. Look for missing values in columns, duplicate rows, or type anomalies. Return a structured list of actionable recommendations that can be executed via Danfo.js. If no significant issues are found, return an empty recommendations array. For 'action_type', rigidly use one of: 'drop_duplicates', 'drop_na', 'fill_na_median', 'fill_na_mean', 'fill_na_zero'. Provide a unique 'id' string for each recommendation.";

  try {
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
    return config;
  } catch (error: any) {
    console.error("Server Action Error:", error);
    throw new Error(error.message || "Failed to analyze data quality via Next.js Action.");
  }
}
