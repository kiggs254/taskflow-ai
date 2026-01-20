import OpenAI from 'openai';
import { config } from '../config/env.js';

// Initialize OpenAI client
const openaiClient = new OpenAI({
  apiKey: config.ai.openai.apiKey,
});

// Initialize Deepseek client (OpenAI-compatible API)
const deepseekClient = new OpenAI({
  apiKey: config.ai.deepseek.apiKey,
  baseURL: config.ai.deepseek.baseURL,
});

/**
 * Get AI client based on provider
 */
const getClient = (provider = 'openai') => {
  return provider === 'deepseek' ? deepseekClient : openaiClient;
};

/**
 * Parse task input using AI
 * Returns structured task data: title, energy, estimatedTime, tags, workspaceSuggestions
 */
export const parseTask = async (input, provider = 'openai') => {
  if (!input || typeof input !== 'string') {
    throw new Error('Invalid input: task input must be a string');
  }

  const client = getClient(provider);
  const model = provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini';

  try {
    const response = await client.chat.completions.create({
      model: model,
      messages: [
        {
          role: 'system',
          content: `You are a task parsing assistant. Analyze task inputs and extract structured information.
Context: User is a busy software developer.
- "Fix bug" usually implies High energy.
- "Email" or "Call" usually implies Low energy.
- Extract time if mentioned (e.g., "20m").
Return valid JSON only.`,
        },
        {
          role: 'user',
          content: `Analyze this task input: "${input}". Extract: title (cleaned of time estimates), energy (high/medium/low), estimatedTime (minutes, default 15), tags (up to 3 short tags), workspaceSuggestions (job/freelance/personal).`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from AI');
    }

    const parsed = JSON.parse(content);
    
    // Validate and normalize response
    return {
      title: parsed.title || input.trim(),
      energy: ['high', 'medium', 'low'].includes(parsed.energy?.toLowerCase())
        ? parsed.energy.toLowerCase()
        : 'medium',
      estimatedTime: parseInt(parsed.estimatedTime) || 15,
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 3) : [],
      workspaceSuggestions: ['job', 'freelance', 'personal'].includes(
        parsed.workspaceSuggestions?.toLowerCase()
      )
        ? parsed.workspaceSuggestions.toLowerCase()
        : undefined,
    };
  } catch (error) {
    console.error('AI parseTask error:', error);
    // Fallback to basic parsing
    return {
      title: input.trim(),
      energy: 'medium',
      estimatedTime: 15,
      tags: [],
    };
  }
};

/**
 * Get daily motivation message based on completed and pending tasks
 */
export const getDailyMotivation = async (
  completedTasks,
  pendingTasks,
  provider = 'openai'
) => {
  const client = getClient(provider);
  const model = provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini';

  try {
    const response = await client.chat.completions.create({
      model: model,
      messages: [
        {
          role: 'user',
          content: `User has completed ${completedTasks} tasks and has ${pendingTasks} remaining. Give a short, witty, 1-sentence dopamine-boosting encouragement for a developer. No cringe.`,
        },
      ],
      temperature: 0.8,
      max_tokens: 100,
    });

    return response.choices[0]?.message?.content || "You're crushing it.";
  } catch (error) {
    console.error('AI getDailyMotivation error:', error);
    return "Great work today! Keep pushing forward.";
  }
};

/**
 * Generate daily plan based on pending tasks
 */
export const generateDailyPlan = async (pendingTasks, provider = 'openai') => {
  if (!Array.isArray(pendingTasks) || pendingTasks.length === 0) {
    return 'No tasks left! Enjoy your clean slate.';
  }

  const client = getClient(provider);
  const model = provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini';

  try {
    const tasksList = pendingTasks
      .map((t) => `- ${t.title} (${t.energy || 'medium'} energy)`)
      .join('\n');

    const response = await client.chat.completions.create({
      model: model,
      messages: [
        {
          role: 'user',
          content: `Here are the tasks remaining for tomorrow:
${tasksList}

Create a short, strategic bullet-point plan (max 3 points) for how to tackle these tomorrow to minimize burnout.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 200,
    });

    return response.choices[0]?.message?.content || 'Prioritize high energy tasks in the morning.';
  } catch (error) {
    console.error('AI generateDailyPlan error:', error);
    return 'Focus on the high energy tasks first tomorrow!';
  }
};

/**
 * Generate client follow-up message for a task
 */
export const generateClientFollowUp = async (
  taskTitle,
  provider = 'openai'
) => {
  if (!taskTitle || typeof taskTitle !== 'string') {
    throw new Error('Invalid input: taskTitle must be a string');
  }

  const client = getClient(provider);
  const model = provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini';

  try {
    const response = await client.chat.completions.create({
      model: model,
      messages: [
        {
          role: 'user',
          content: `Draft a professional, short, and polite follow-up message to a client regarding the task: "${taskTitle}". 
Keep it under 280 characters. Casual but professional tone.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 150,
    });

    return response.choices[0]?.message?.content || 'Just checking in on this item.';
  } catch (error) {
    console.error('AI generateClientFollowUp error:', error);
    return 'Hey, just checking in on this.';
  }
};
