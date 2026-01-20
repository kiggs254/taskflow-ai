// AI Service - Now calls backend API instead of Gemini directly
// Backend handles OpenAI and Deepseek integration
import { AIParsedTask, Task } from "../types";

const API_BASE = process.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

// Helper function to make authenticated AI API calls
const aiRequest = async (
  endpoint: string,
  body: any,
  token: string,
  provider: 'openai' | 'deepseek' = 'openai'
): Promise<any> => {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  try {
    const res = await fetch(`${API_BASE}/ai/${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...body, provider }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(errorData.error || `HTTP ${res.status}`);
    }

    return await res.json();
  } catch (error) {
    console.error(`AI API Error (${endpoint}):`, error);
    throw error;
  }
};

/**
 * Parse task input using AI (now calls backend)
 * @deprecated Renamed from parseTaskWithGemini - now uses backend AI service
 */
export const parseTaskWithGemini = async (
  input: string,
  token: string,
  provider: 'openai' | 'deepseek' = 'openai'
): Promise<AIParsedTask | null> => {
  if (!token) {
    console.warn("Token is missing. Returning default task structure.");
    return null;
  }

  try {
    const result = await aiRequest('parse-task', { input }, token, provider);
    return result;
  } catch (error) {
    console.error("AI parsing failed:", error);
    return null;
  }
};

export const getDailyMotivation = async (
  completedTasks: number,
  pendingTasks: number,
  token: string,
  provider: 'openai' | 'deepseek' = 'openai'
): Promise<string> => {
  if (!token) return "Great work today! Keep pushing forward.";

  try {
    const result = await aiRequest(
      'daily-motivation',
      { completedTasks, pendingTasks },
      token,
      provider
    );
    return result.message || "You're crushing it.";
  } catch (e) {
    console.error("Daily motivation failed:", e);
    return "Stay flowy.";
  }
};

export const generateDailyPlan = async (
  pendingTasks: Task[],
  token: string,
  provider: 'openai' | 'deepseek' = 'openai'
): Promise<string> => {
  if (!token) return "Focus on the high energy tasks first tomorrow!";
  if (pendingTasks.length === 0) return "No tasks left! Enjoy your clean slate.";

  try {
    const result = await aiRequest(
      'daily-plan',
      { pendingTasks },
      token,
      provider
    );
    return result.plan || "Prioritize high energy tasks in the morning.";
  } catch (error) {
    console.error("Daily plan failed:", error);
    return "Plan failed to load.";
  }
};

export const generateClientFollowUp = async (
  taskTitle: string,
  token: string,
  provider: 'openai' | 'deepseek' = 'openai'
): Promise<string> => {
  if (!token) return "Hey, just checking in on this.";

  try {
    const result = await aiRequest(
      'client-followup',
      { taskTitle },
      token,
      provider
    );
    return result.message || "Just checking in on this item.";
  } catch (error) {
    console.error("Client followup failed:", error);
    return "Follow-up generation failed.";
  }
};