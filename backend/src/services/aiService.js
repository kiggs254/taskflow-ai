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
export const parseTask = async (input, provider = 'openai', options = {}) => {
  if (!input || typeof input !== 'string') {
    throw new Error('Invalid input: task input must be a string');
  }

  const promptInstructions = options.promptInstructions
    ? `Additional instructions from user:\n${options.promptInstructions}\n\n`
    : '';

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
Return valid JSON only.
${promptInstructions}`,
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

/**
 * Generate completion message for Slack task
 */
export const generateCompletionMessage = async (
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
          content: `Generate a short, friendly Slack message to inform someone that the task "${taskTitle}" has been completed. 
Keep it under 200 characters. Be casual and professional. Start with something like "Done!" or "Completed!"`,
        },
      ],
      temperature: 0.7,
      max_tokens: 100,
    });

    return response.choices[0]?.message?.content || `✅ Done! "${taskTitle}" has been completed.`;
  } catch (error) {
    console.error('AI generateCompletionMessage error:', error);
    return `✅ Done! "${taskTitle}" has been completed.`;
  }
};

/**
 * Check if an email is relevant based on user's prompt instructions (dos and don'ts)
 * Returns { isRelevant: boolean, reason: string }
 */
export const checkEmailRelevance = async (emailSummary, promptInstructions, provider = 'openai') => {
  if (!promptInstructions || !promptInstructions.trim()) {
    // No instructions provided, consider all emails relevant
    return { isRelevant: true, reason: 'No filter instructions provided' };
  }

  const client = getClient(provider);
  const model = provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini';

  try {
    const response = await client.chat.completions.create({
      model: model,
      messages: [
        {
          role: 'system',
          content: `You are an email filter assistant. Your job is to determine if an email should be converted into a task based on the user's instructions.

The user has provided these filtering rules (dos and don'ts):
${promptInstructions}

Based on these rules, determine if the email should be processed as a task.
Return valid JSON with: { "isRelevant": boolean, "reason": string }

- isRelevant: true if the email SHOULD become a task, false if it should be SKIPPED
- reason: Brief explanation of why (1 sentence)

Be strict about following the user's instructions. If they say to ignore certain types of emails, ignore them.`,
        },
        {
          role: 'user',
          content: `Should this email be converted to a task?\n\n${emailSummary.substring(0, 2000)}`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 200,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return { isRelevant: true, reason: 'Could not determine relevance' };
    }

    const parsed = JSON.parse(content);
    return {
      isRelevant: parsed.isRelevant !== false, // Default to true if unclear
      reason: parsed.reason || 'No reason provided',
    };
  } catch (error) {
    console.error('AI checkEmailRelevance error:', error);
    // On error, default to processing the email
    return { isRelevant: true, reason: 'Error checking relevance, processing anyway' };
  }
};

/**
 * Parse full email thread and extract title, todos, and formatted description
 */
export const parseEmailThread = async (fullThreadContent, provider = 'openai', promptInstructions = '') => {
  if (!fullThreadContent || typeof fullThreadContent !== 'string') {
    throw new Error('Invalid input: fullThreadContent must be a string');
  }

  const client = getClient(provider);
  const model = provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini';

  const customInstructions = promptInstructions
    ? `\n\nAdditional user instructions for task extraction: ${promptInstructions}`
    : '';

  try {
    const response = await client.chat.completions.create({
      model: model,
      messages: [
        {
          role: 'system',
          content: `You are an email thread analyzer. Analyze the full email thread and extract:
1. A clear, concise task title (max 100 characters)
2. All action items/todos mentioned in the thread (as a markdown checklist)
3. Key information and context
4. Important dates or deadlines

Format the output as markdown with:
- A summary section
- Action items as checkboxes (- [ ] item)
- Key participants and their roles
- Important dates/deadlines

Return valid JSON with: { title: string, description: string (markdown), todos: string[] }`,
        },
        {
          role: 'user',
          content: `Analyze this email thread and extract the task title, todos, and create a well-formatted markdown description:\n\n${fullThreadContent.substring(0, 8000)}${customInstructions}`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from AI');
    }

    const parsed = JSON.parse(content);
    
    return {
      title: parsed.title || null,
      description: parsed.description || fullThreadContent.substring(0, 2000),
      todos: parsed.todos || [],
    };
  } catch (error) {
    console.error('AI parseEmailThread error:', error);
    // Fallback
    return {
      title: null,
      description: fullThreadContent.substring(0, 2000),
      todos: [],
    };
  }
};

/**
 * Generate email completion reply for Gmail tasks
 */
export const generateEmailCompletionReply = async (
  taskTitle,
  taskDescription,
  provider = 'openai'
) => {
  if (!taskTitle || typeof taskTitle !== 'string') {
    throw new Error('Invalid input: taskTitle must be a string');
  }

  const client = getClient(provider);
  const model = provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini';

  // Extract context from description (remove metadata comments)
  const cleanDescription = taskDescription
    ? taskDescription.replace(/<!-- Email metadata:.*?-->/, '').replace(/<!-- Slack metadata:.*?-->/, '').trim()
    : '';

  try {
    const response = await client.chat.completions.create({
      model: model,
      messages: [
        {
          role: 'system',
          content: `You are an email assistant. Generate a brief, professional email reply to inform the sender that a task has been completed. Keep it concise (2-3 sentences max) and professional.`,
        },
        {
          role: 'user',
          content: `Generate a completion email reply for this task:
          
Task: ${taskTitle}
${cleanDescription ? `Context: ${cleanDescription.substring(0, 500)}` : ''}

Write a brief, professional email reply informing them the task is complete.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 200,
    });

    return response.choices[0]?.message?.content || 'Thank you for your email. This task has been completed.';
  } catch (error) {
    console.error('AI generateEmailCompletionReply error:', error);
    throw error;
  }
};

/**
 * Generate email draft reply with AI based on task context and tone
 */
export const generateEmailDraft = async (
  taskTitle,
  taskDescription,
  emailSubject,
  tone = 'professional',
  provider = 'openai',
  customInstructions = ''
) => {
  if (!taskTitle || typeof taskTitle !== 'string') {
    throw new Error('Invalid input: taskTitle must be a string');
  }

  const client = getClient(provider);
  const model = provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini';

  // Define tone instructions
  const toneInstructions = {
    professional: 'Write in a professional, formal business tone. Use proper salutations and closings.',
    casual: 'Write in a friendly, casual tone. Keep it conversational and relaxed.',
    friendly: 'Write in a warm, friendly tone. Be approachable and personable.',
    concise: 'Write in a brief, to-the-point tone. Keep it short and direct.',
    urgent: 'Write in an urgent but professional tone. Convey importance without being pushy.',
  };

  const tonePrompt = toneInstructions[tone] || toneInstructions.professional;
  const customPrompt = customInstructions
    ? `\n\nAdditional instructions: ${customInstructions}`
    : '';

  // Extract context from description (remove metadata comments)
  const cleanDescription = taskDescription
    ? taskDescription.replace(/<!-- Email metadata:.*?-->/, '').replace(/<!-- Slack metadata:.*?-->/, '').trim()
    : '';

  try {
    const response = await client.chat.completions.create({
      model: model,
      messages: [
        {
          role: 'system',
          content: `You are an email writing assistant. Generate a well-written email reply based on the task context. ${tonePrompt}${customPrompt}`,
        },
        {
          role: 'user',
          content: `Generate an email reply for the following task:
          
Task: ${taskTitle}
${cleanDescription ? `Context: ${cleanDescription.substring(0, 1000)}` : ''}
Email Subject: ${emailSubject || 'No subject'}

Write an appropriate email reply that addresses the task. Keep it relevant to the context and appropriate for the tone requested.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    return response.choices[0]?.message?.content || 'Thank you for your email. I will look into this.';
  } catch (error) {
    console.error('AI generateEmailDraft error:', error);
    throw error;
  }
};

/**
 * Polish email reply with AI
 */
export const polishEmailReply = async (
  message,
  provider = 'openai',
  instructions = ''
) => {
  if (!message || typeof message !== 'string') {
    throw new Error('Invalid input: message must be a string');
  }

  const client = getClient(provider);
  const model = provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini';

  const customInstructions = instructions
    ? `\n\nCustom instructions: ${instructions}`
    : '';

  try {
    const response = await client.chat.completions.create({
      model: model,
      messages: [
        {
          role: 'system',
          content: `You are an email writing assistant. Polish and improve email messages to be professional, clear, and appropriate for business communication.${customInstructions}`,
        },
        {
          role: 'user',
          content: `Polish and improve this email message:\n\n${message}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    return response.choices[0]?.message?.content || message;
  } catch (error) {
    console.error('AI polishEmailReply error:', error);
    return message; // Return original if polish fails
  }
};
