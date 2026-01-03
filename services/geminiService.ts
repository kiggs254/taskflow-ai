// Fix: The `Schema` type is not exported from @google/genai.
import { GoogleGenAI, Type } from "@google/genai";
import { AIParsedTask, EnergyLevel, Task } from "../types";

// Fix: Removed `Schema` type annotation as it is not available.
const parseTaskSchema = {
  type: Type.OBJECT,
  properties: {
    title: {
      type: Type.STRING,
      description: "A clear, concise title for the task, cleaned of time estimates.",
    },
    energy: {
      type: Type.STRING,
      enum: ["high", "medium", "low"],
      description: "The estimated cognitive load or energy required. 'high' for coding/complex logic, 'low' for admin/replies.",
    },
    estimatedTime: {
      type: Type.INTEGER,
      description: "Estimated time in minutes. Default to 15 if unknown.",
    },
    tags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Up to 3 relevant short tags (e.g., 'bug', 'frontend', 'client').",
    },
    workspaceSuggestions: {
      type: Type.STRING,
      enum: ["job", "freelance", "personal"],
      description: "Suggested workspace based on context (e.g., 'invoice' -> freelance).",
    },
  },
  required: ["title", "energy", "estimatedTime", "tags"],
};

export const parseTaskWithGemini = async (
  input: string
): Promise<AIParsedTask | null> => {
  if (!process.env.API_KEY) {
    console.warn("API Key is missing. Returning default task structure.");
    return null;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // We use gemini-2.5-flash for speed as this is a real-time UI action
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Analyze this task input: "${input}". 
      Context: User is a busy software developer. 
      - "Fix bug" usually implies High energy.
      - "Email" or "Call" usually implies Low energy.
      - Extract time if mentioned (e.g. "20m").`,
      config: {
        responseMimeType: "application/json",
        responseSchema: parseTaskSchema,
        temperature: 0.3, // Low temperature for deterministic categorization
      },
    });

    const text = response.text;
    if (!text) return null;

    return JSON.parse(text) as AIParsedTask;
  } catch (error) {
    console.error("Gemini parsing failed:", error);
    return null;
  }
};

export const getDailyMotivation = async (
  completedTasks: number,
  pendingTasks: number
): Promise<string> => {
  if (!process.env.API_KEY) return "Great work today! Keep pushing forward.";

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `User has completed ${completedTasks} tasks and has ${pendingTasks} remaining. Give a short, witty, 1-sentence dopamine-boosting encouragement for a developer. No cringe.`,
    });
    return response.text || "You're crushing it.";
  } catch (e) {
    return "Stay flowy.";
  }
};

export const generateDailyPlan = async (pendingTasks: Task[]): Promise<string> => {
  if (!process.env.API_KEY) return "Focus on the high energy tasks first tomorrow!";
  if (pendingTasks.length === 0) return "No tasks left! Enjoy your clean slate.";

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const tasksList = pendingTasks.map(t => `- ${t.title} (${t.energy} energy)`).join('\n');
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Here are the tasks remaining for tomorrow:
      ${tasksList}
      
      Create a short, strategic bullet-point plan (max 3 points) for how to tackle these tomorrow to minimize burnout.`,
    });
    return response.text || "Prioritize high energy tasks in the morning.";
  } catch (error) {
    return "Plan failed to load.";
  }
};

export const generateClientFollowUp = async (taskTitle: string): Promise<string> => {
  if (!process.env.API_KEY) return "Hey, just checking in on this.";

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Draft a professional, short, and polite follow-up message to a client regarding the task: "${taskTitle}". 
      Keep it under 280 characters. Casual but professional tone.`,
    });
    return response.text || "Just checking in on this item.";
  } catch (error) {
    return "Follow-up generation failed.";
  }
};