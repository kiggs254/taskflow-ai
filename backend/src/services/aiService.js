import OpenAI from 'openai';
import { config } from '../config/env.js';

// Initialize OpenAI client (only if API key exists)
const openaiClient = config.ai.openai.apiKey 
  ? new OpenAI({
      apiKey: config.ai.openai.apiKey,
    })
  : null;

// Initialize Deepseek client (OpenAI-compatible API) (only if API key exists)
const deepseekClient = config.ai.deepseek.apiKey
  ? new OpenAI({
      apiKey: config.ai.deepseek.apiKey,
      baseURL: config.ai.deepseek.baseURL,
    })
  : null;

/**
 * Get AI client based on provider
 */
const getClient = (provider = 'openai') => {
  if (provider === 'deepseek') {
    if (!deepseekClient) {
      throw new Error('Deepseek API key not configured. Please set DEEPSEEK_API_KEY environment variable.');
    }
    return deepseekClient;
  } else {
    if (!openaiClient) {
      throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.');
    }
    return openaiClient;
  }
};

/**
 * Try OpenAI first, fallback to Deepseek if OpenAI fails
 * @param {Function} fn - Internal function that takes provider as first arg, then other args
 * @param {...any} args - Arguments to pass to the function (after provider)
 */
const tryWithFallback = async (fn, ...args) => {
  console.log('tryWithFallback: Attempting OpenAI first');
  try {
    // Try OpenAI first
    const result = await fn('openai', ...args);
    console.log('tryWithFallback: OpenAI succeeded');
    return result;
  } catch (openaiError) {
    console.log('tryWithFallback: OpenAI failed, error:', openaiError.message, 'type:', openaiError.constructor.name);
    // Check if it's an API key error or client initialization error
    const isApiKeyError = openaiError.message && (
      openaiError.message.includes('API key not configured') ||
      openaiError.message.includes('OPENAI_API_KEY') ||
      openaiError.message.includes('apiKey') ||
      openaiError.message.includes('not configured')
    );
    
    if (isApiKeyError) {
      console.warn('OpenAI API key issue detected, checking Deepseek availability...');
      // If OpenAI API key is missing but Deepseek is available, use Deepseek
      if (deepseekClient) {
        console.log('Using Deepseek as primary provider since OpenAI is not configured');
        try {
          const result = await fn('deepseek', ...args);
          console.log('tryWithFallback: Deepseek succeeded as fallback');
          return result;
        } catch (deepseekError) {
          console.error('tryWithFallback: Deepseek fallback also failed:', deepseekError.message);
          throw new Error(`OpenAI not configured and Deepseek also failed: ${deepseekError.message}`);
        }
      }
      // If neither is available, throw the original error
      console.error('tryWithFallback: Neither OpenAI nor Deepseek available');
      throw openaiError;
    }
    
    console.warn('OpenAI request failed, falling back to Deepseek:', {
      message: openaiError.message,
      status: openaiError.status,
    });
    
    // Check if Deepseek is available
    if (!deepseekClient) {
      console.error('Deepseek not available for fallback');
      throw new Error(`OpenAI failed and Deepseek is not configured. Original error: ${openaiError.message}`);
    }
    
    // Fallback to Deepseek
    try {
      return await fn('deepseek', ...args);
    } catch (deepseekError) {
      console.error('Deepseek fallback also failed:', {
        message: deepseekError.message,
        status: deepseekError.status,
      });
      throw new Error(`Both OpenAI and Deepseek failed. OpenAI: ${openaiError.message}, Deepseek: ${deepseekError.message}`);
    }
  }
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
 * 
 * NOTE: This is a LENIENT filter - it only excludes emails that are EXPLICITLY 
 * mentioned in the user's "don't" instructions. When in doubt, process the email.
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
          content: `You are a lenient email filter assistant. Your DEFAULT behavior is to APPROVE emails for task creation.

The user has provided these filtering preferences:
${promptInstructions}

IMPORTANT RULES:
1. DEFAULT TO APPROVING - When in doubt, return isRelevant: true
2. Only return isRelevant: false if the email CLEARLY and EXPLICITLY matches something the user said to IGNORE or SKIP
3. Newsletters, promotional emails, and automated notifications should generally be skipped
4. Emails from real people asking for something or providing information should generally be APPROVED
5. If the user's instructions are vague, lean towards APPROVING the email

Return valid JSON with: { "isRelevant": boolean, "reason": string }`,
        },
        {
          role: 'user',
          content: `Should this email be converted to a task? Remember: default to YES unless it clearly matches an exclusion rule.\n\n${emailSummary.substring(0, 2000)}`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 200,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return { isRelevant: true, reason: 'Could not determine relevance, defaulting to process' };
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
 * Parse full email thread and extract title, todos, subtasks, and formatted description
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
1. A clear, concise task title (max 100 characters) - this should be the main deliverable or action requested
2. Subtasks - individual actionable items that need to be completed as part of this task
3. Key information and context as a markdown description
4. Important dates or deadlines
5. Meeting links - look for Zoom, Google Meet, Microsoft Teams, Webex, or other video conferencing links

Return valid JSON with:
{
  "title": string (main task title, max 100 chars),
  "description": string (markdown formatted context and details),
  "subtasks": string[] (array of specific action items/subtasks to complete),
  "deadline": string | null (ISO date if mentioned),
  "meetingLink": string | null (video conference URL if found - Zoom, Meet, Teams, etc.)
}

For subtasks:
- Extract specific, actionable items from the email
- Each subtask should be completable independently
- Keep subtasks concise (max 100 chars each)
- Maximum 10 subtasks
- Examples: "Review attached proposal", "Schedule meeting with client", "Update project timeline"`,
        },
        {
          role: 'user',
          content: `Analyze this email thread and extract the task title, subtasks, and create a well-formatted markdown description:\n\n${fullThreadContent.substring(0, 8000)}${customInstructions}`,
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
    
    // Convert subtasks array to subtask objects with IDs
    const subtasks = (parsed.subtasks || []).slice(0, 10).map((title, index) => ({
      id: `subtask-${Date.now()}-${index}`,
      title: String(title).substring(0, 100),
      completed: false,
    }));
    
    // Also try to extract meeting link with regex as backup
    let meetingLink = parsed.meetingLink || null;
    if (!meetingLink) {
      // Regex patterns for common meeting links
      const meetingPatterns = [
        /https:\/\/[\w.-]*zoom\.us\/[^\s<>"')]+/i,
        /https:\/\/meet\.google\.com\/[^\s<>"')]+/i,
        /https:\/\/teams\.microsoft\.com\/[^\s<>"')]+/i,
        /https:\/\/[\w.-]*webex\.com\/[^\s<>"')]+/i,
        /https:\/\/[\w.-]*gotomeeting\.com\/[^\s<>"')]+/i,
        /https:\/\/[\w.-]*whereby\.com\/[^\s<>"')]+/i,
        /https:\/\/cal\.com\/[^\s<>"')]+/i,
        /https:\/\/calendly\.com\/[^\s<>"')]+/i,
      ];
      
      for (const pattern of meetingPatterns) {
        const match = fullThreadContent.match(pattern);
        if (match) {
          meetingLink = match[0];
          break;
        }
      }
    }
    
    return {
      title: parsed.title || null,
      description: parsed.description || fullThreadContent.substring(0, 2000),
      subtasks,
      deadline: parsed.deadline || null,
      meetingLink,
    };
  } catch (error) {
    console.error('AI parseEmailThread error:', error);
    // Fallback - still try to extract meeting link
    let meetingLink = null;
    const meetingPatterns = [
      /https:\/\/[\w.-]*zoom\.us\/[^\s<>"')]+/i,
      /https:\/\/meet\.google\.com\/[^\s<>"')]+/i,
      /https:\/\/teams\.microsoft\.com\/[^\s<>"')]+/i,
      /https:\/\/[\w.-]*webex\.com\/[^\s<>"')]+/i,
    ];
    
    for (const pattern of meetingPatterns) {
      const match = fullThreadContent.match(pattern);
      if (match) {
        meetingLink = match[0];
        break;
      }
    }
    
    return {
      title: null,
      description: fullThreadContent.substring(0, 2000),
      subtasks: [],
      deadline: null,
      meetingLink,
    };
  }
};

const _generateEmailCompletionReplyInternal = async (provider, taskTitle, taskDescription, userName) => {
  const client = getClient(provider);
  const model = provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini';

  // Extract context from description (remove metadata comments)
  const cleanDescription = taskDescription
    ? taskDescription.replace(/<!-- Email metadata:.*?-->/, '').replace(/<!-- Slack metadata:.*?-->/, '').trim()
    : '';

  // Get first name from full name
  const firstName = userName ? userName.split(' ')[0] : '';
  const signOff = firstName ? `\n\nKind Regards,\n${firstName}` : '';

  const response = await client.chat.completions.create({
    model: model,
    messages: [
      {
        role: 'system',
        content: `You are an email assistant writing on behalf of ${userName || 'the user'}. Generate a brief, professional email reply to inform the sender that a task has been completed. Keep it concise (2-3 sentences max) and professional. ${firstName ? `Sign off with "Kind Regards,\\n${firstName}" - do NOT use placeholders like {name} or [name].` : 'Do not include a sign-off.'}`,
      },
      {
        role: 'user',
        content: `Generate a completion email reply for this task:
        
Task: ${taskTitle}
${cleanDescription ? `Context: ${cleanDescription.substring(0, 500)}` : ''}
${firstName ? `\nIMPORTANT: Sign off exactly as "Kind Regards,\\n${firstName}" - no placeholders.` : ''}

Write a brief, professional email reply informing them the task is complete.`,
      },
    ],
    temperature: 0.7,
    max_tokens: 200,
  });

  return response.choices[0]?.message?.content || 'Thank you for your email. This task has been completed.';
};

/**
 * Generate email completion reply for Gmail tasks
 */
export const generateEmailCompletionReply = async (
  taskTitle,
  taskDescription,
  provider = 'openai',
  userName = ''
) => {
  if (!taskTitle || typeof taskTitle !== 'string') {
    throw new Error('Invalid input: taskTitle must be a string');
  }

  try {
    // If provider is explicitly set to deepseek, use it directly
    if (provider === 'deepseek') {
      return await _generateEmailCompletionReplyInternal(provider, taskTitle, taskDescription, userName);
    }
    
    // Otherwise, try OpenAI first, fallback to Deepseek
    return await tryWithFallback(
      _generateEmailCompletionReplyInternal,
      taskTitle,
      taskDescription,
      userName
    );
  } catch (error) {
    console.error('AI generateEmailCompletionReply error:', error);
    throw error;
  }
};

/**
 * Generate email draft reply with AI based on task context and tone
 */
const _generateEmailDraftInternal = async (
  provider,
  taskTitle,
  taskDescription,
  emailSubject,
  tone,
  customInstructions,
  userName
) => {
  console.log(`_generateEmailDraftInternal: Getting client for provider: ${provider}`);
  let client;
  try {
    client = getClient(provider);
    console.log(`_generateEmailDraftInternal: Client obtained for ${provider}`);
  } catch (clientError) {
    console.error(`_generateEmailDraftInternal: Failed to get client for ${provider}:`, clientError.message);
    // Re-throw client initialization errors so fallback can handle them
    throw clientError;
  }
  const model = provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini';
  console.log(`_generateEmailDraftInternal: Using model: ${model}`);

  // Get first name from full name
  const firstName = userName ? userName.split(' ')[0] : '';

  // Define tone instructions
  const toneInstructions = {
    professional: `Write in a professional, formal business tone. ${firstName ? `Sign off with "Kind Regards,\\n${firstName}"` : 'Use proper closings.'}`,
    casual: `Write in a friendly, casual tone. Keep it conversational. ${firstName ? `Sign off with "Cheers,\\n${firstName}" or "Best,\\n${firstName}"` : ''}`,
    friendly: `Write in a warm, friendly tone. Be approachable and personable. ${firstName ? `Sign off with "Best regards,\\n${firstName}"` : ''}`,
    concise: `Write in a brief, to-the-point tone. Keep it short and direct. ${firstName ? `Sign off with "Best,\\n${firstName}"` : ''}`,
    urgent: `Write in an urgent but professional tone. Convey importance without being pushy. ${firstName ? `Sign off with "Regards,\\n${firstName}"` : ''}`,
  };

  const tonePrompt = toneInstructions[tone] || toneInstructions.professional;
  const customPrompt = customInstructions
    ? `\n\nAdditional instructions: ${customInstructions}`
    : '';

  // Extract context from description (remove metadata comments)
  const cleanDescription = taskDescription
    ? taskDescription.replace(/<!-- Email metadata:.*?-->/, '').replace(/<!-- Slack metadata:.*?-->/, '').trim()
    : '';

  const signOffInstruction = firstName 
    ? `\n\nIMPORTANT: You are writing on behalf of ${userName}. Sign off the email EXACTLY as specified (e.g., "Kind Regards,\\n${firstName}"). Do NOT use placeholders like {name}, [Your Name], [Name], etc. Use the actual name provided.`
    : '';

  const response = await client.chat.completions.create({
    model: model,
    messages: [
      {
        role: 'system',
        content: `You are an email writing assistant writing on behalf of ${userName || 'the user'}. Generate a well-written email reply based on the task context. ${tonePrompt}${customPrompt}${signOffInstruction}`,
      },
      {
        role: 'user',
        content: `Generate an email reply for the following task:
        
Task: ${taskTitle}
${cleanDescription ? `Context: ${cleanDescription.substring(0, 1000)}` : ''}
Email Subject: ${emailSubject || 'No subject'}

Write an appropriate email reply that addresses the task. Keep it relevant to the context and appropriate for the tone requested.${firstName ? `\n\nSign off with the user's actual name (${firstName}), not a placeholder.` : ''}`,
      },
    ],
    temperature: 0.7,
    max_tokens: 500,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('AI returned empty response');
  }
  return content;
};

export const generateEmailDraft = async (
  taskTitle,
  taskDescription,
  emailSubject,
  tone = 'professional',
  provider = 'openai',
  customInstructions = '',
  userName = ''
) => {
  if (!taskTitle || typeof taskTitle !== 'string') {
    throw new Error('Invalid input: taskTitle must be a string');
  }

  console.log('generateEmailDraft called with:', { 
    taskTitle: taskTitle.substring(0, 50), 
    provider, 
    hasOpenAI: !!openaiClient, 
    hasDeepseek: !!deepseekClient 
  });

  try {
    // If provider is explicitly set to deepseek, use it directly
    if (provider === 'deepseek') {
      console.log('Using Deepseek directly');
      return await _generateEmailDraftInternal(provider, taskTitle, taskDescription, emailSubject, tone, customInstructions, userName);
    }
    
    // Otherwise, try OpenAI first, fallback to Deepseek
    console.log('Using OpenAI with Deepseek fallback');
    return await tryWithFallback(
      _generateEmailDraftInternal,
      taskTitle,
      taskDescription,
      emailSubject,
      tone,
      customInstructions,
      userName
    );
  } catch (error) {
    console.error('AI generateEmailDraft error:', {
      message: error.message,
      type: error.constructor.name,
      status: error.status,
      response: error.response?.data,
      stack: error.stack,
    });
    throw new Error(`Failed to generate email draft: ${error.message}`);
  }
};

/**
 * Enhance email message with AI based on style (short or detailed)
 */
const _enhanceEmailMessageInternal = async (provider, message, style, taskContext, userName) => {
  const client = getClient(provider);
  const model = provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini';

  const firstName = userName ? userName.split(' ')[0] : '';
  
  // Style instructions
  const styleInstructions = {
    short: 'Make the message concise and to-the-point. Keep it brief while maintaining clarity. Remove unnecessary words and get straight to the point.',
    detailed: 'Expand and enhance the message with more detail, context, and professional language. Add relevant information and make it comprehensive while keeping it professional.',
  };

  const stylePrompt = styleInstructions[style] || styleInstructions.short;
  
  const contextPrompt = taskContext
    ? `\n\nTask context (for reference only, don't include in the email):\n${taskContext}`
    : '';

  const signOffInstruction = firstName 
    ? `\n\nIMPORTANT: If the email needs a sign-off, use the user's actual name: "${firstName}". Do NOT use placeholders like {name}, [Your Name], or similar.`
    : '';

  const response = await client.chat.completions.create({
    model: model,
    messages: [
      {
        role: 'system',
        content: `You are an email writing assistant${userName ? ` writing on behalf of ${userName}` : ''}. Enhance and improve the user's email message to be professional, clear, and appropriate for business communication. ${stylePrompt}${signOffInstruction}

CRITICAL: Return ONLY the email body text. Do NOT include:
- Subject line
- "Subject:" header
- Any headers
- Just return the message body content starting directly with the greeting or first sentence.`,
      },
      {
        role: 'user',
        content: `Enhance this email message body according to the ${style} style. Return ONLY the body text (no subject, no headers):\n\n${message}${contextPrompt}${firstName ? `\n\nIf adding or updating the sign-off, use "Kind Regards,\n${firstName}" - no placeholders.` : ''}`,
      },
    ],
    temperature: 0.7,
    max_tokens: style === 'short' ? 300 : 800,
  });

  let content = response.choices[0]?.message?.content;
  if (!content) {
    console.warn('AI enhanceEmailMessage returned empty response, using original message');
    return message;
  }
  
  // Remove any subject lines that might have been included
  // Remove lines starting with "Subject:" (case insensitive)
  content = content.replace(/^Subject:\s*.+$/gmi, '').trim();
  // Remove any standalone "Subject:" lines
  content = content.replace(/^Subject:\s*$/gmi, '').trim();
  // Remove empty lines at the start
  content = content.replace(/^\s*\n+/, '').trim();
  
  return content;
};

export const enhanceEmailMessage = async (
  message,
  style = 'short',
  provider = 'openai',
  taskContext = '',
  userName = ''
) => {
  if (!message || typeof message !== 'string') {
    throw new Error('Invalid input: message must be a string');
  }
  
  if (style !== 'short' && style !== 'detailed') {
    throw new Error('Invalid style: must be "short" or "detailed"');
  }

  try {
    // If provider is explicitly set to deepseek, use it directly
    if (provider === 'deepseek') {
      return await _enhanceEmailMessageInternal(provider, message, style, taskContext, userName);
    }
    
    // Otherwise, try OpenAI first, fallback to Deepseek
    return await tryWithFallback(
      _enhanceEmailMessageInternal,
      message,
      style,
      taskContext,
      userName
    );
  } catch (error) {
    console.error('AI enhanceEmailMessage error:', {
      message: error.message,
      type: error.constructor.name,
      status: error.status,
      response: error.response?.data,
      stack: error.stack,
    });
    // Return original message if enhance fails (non-blocking)
    return message;
  }
};

/**
 * Polish email reply with AI
 */
const _polishEmailReplyInternal = async (provider, message, instructions, userName) => {
  const client = getClient(provider);
  const model = provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini';

  const firstName = userName ? userName.split(' ')[0] : '';
  
  const customInstructions = instructions
    ? `\n\nCustom instructions: ${instructions}`
    : '';

  const signOffInstruction = firstName 
    ? `\n\nIMPORTANT: If the email needs a sign-off, use the user's actual name: "${firstName}". Do NOT use placeholders like {name}, [Your Name], or similar.`
    : '';

  const response = await client.chat.completions.create({
    model: model,
    messages: [
      {
        role: 'system',
        content: `You are an email writing assistant${userName ? ` writing on behalf of ${userName}` : ''}. Polish and improve email messages to be professional, clear, and appropriate for business communication.${customInstructions}${signOffInstruction}`,
      },
      {
        role: 'user',
        content: `Polish and improve this email message:\n\n${message}${firstName ? `\n\nIf adding or updating the sign-off, use "Kind Regards,\n${firstName}" - no placeholders.` : ''}`,
      },
    ],
    temperature: 0.7,
    max_tokens: 500,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    console.warn('AI polishEmailReply returned empty response, using original message');
    return message;
  }
  return content;
};

export const polishEmailReply = async (
  message,
  provider = 'openai',
  instructions = '',
  userName = ''
) => {
  if (!message || typeof message !== 'string') {
    throw new Error('Invalid input: message must be a string');
  }

  try {
    // If provider is explicitly set to deepseek, use it directly
    if (provider === 'deepseek') {
      return await _polishEmailReplyInternal(provider, message, instructions, userName);
    }
    
    // Otherwise, try OpenAI first, fallback to Deepseek
    return await tryWithFallback(
      _polishEmailReplyInternal,
      message,
      instructions,
      userName
    );
  } catch (error) {
    console.error('AI polishEmailReply error:', {
      message: error.message,
      type: error.constructor.name,
      status: error.status,
      response: error.response?.data,
      stack: error.stack,
    });
    // Return original message if polish fails (non-blocking)
    return message;
  }
};
