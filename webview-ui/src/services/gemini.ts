import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: apiKey || "" });

export async function generateAIResponse(prompt: string, systemInstruction?: string) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: prompt,
      config: {
        systemInstruction: systemInstruction || "You are a world-class senior software engineer and AI coding assistant.",
      },
    });
    return response.text;
  } catch (error) {
    console.error("AI Generation Error:", error);
    return "Error generating response. Please check your API key and connection.";
  }
}
