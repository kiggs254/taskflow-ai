
import { Task, User, UserStats, DraftTask } from '../types';

// TODO: Update this to your Coolify backend URL
// Example: https://api.yourdomain.com or https://your-app-name.coolify.app
// Note: Can include /api or not - we'll normalize it
let API_BASE = process.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

// Ensure API_BASE ends with /api
if (!API_BASE.endsWith('/api')) {
  // Remove trailing slash if present, then add /api
  API_BASE = API_BASE.replace(/\/$/, '') + '/api';
}

// Helper to handle requests
const request = async (action: string, method: 'GET' | 'POST', body?: any, token?: string) => {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const config: RequestInit = {
    method,
    headers,
    mode: 'cors',
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(`${API_BASE}?action=${action}`, config);
    const text = await res.text();
    
    // Handle non-JSON responses (like 404 HTML pages or 500 errors)
    const contentType = res.headers.get("content-type");
    if (contentType && contentType.toLowerCase().indexOf("application/json") === -1) {
       console.error("API returned non-JSON:", text.substring(0, 100)); // Log first 100 chars
       throw new Error(`Server Error (${res.status}). URL might be wrong.`);
    }

    if (!text) {
        throw new Error('Server returned empty response. Check PHP logs for Fatal Errors.');
    }

    const data = JSON.parse(text);
    
    if (!res.ok) {
      throw new Error(data.error || 'API Request Failed');
    }
    return data;
  } catch (error) {
    console.error(`API Error (${action}):`, error);
    throw error;
  }
};

export const api = {
  // Auth
  login: async (email: string, password: string) => {
    return request('login', 'POST', { email, password });
  },

  register: async (username: string, email: string, password: string) => {
    return request('register', 'POST', { username, email, password });
  },

  // Tasks
  getTasks: async (token: string): Promise<Task[]> => {
    return request('get_tasks', 'GET', undefined, token);
  },

  syncTask: async (token: string, task: Task) => {
    return request('sync_tasks', 'POST', task, token);
  },

  deleteTask: async (token: string, id: string) => {
    return request('delete_task', 'POST', { id }, token);
  },

  completeTask: async (token: string, id: string, sendEmailReply = false) => {
    return request('complete_task', 'POST', { id, sendEmailReply }, token);
  },
  
  uncompleteTask: async (token: string, id: string) => {
    return request('uncomplete_task', 'POST', { id }, token);
  },

  // Misc
  dailyReset: async (token: string) => {
    return request('daily_reset', 'POST', {}, token);
  },

  // User Preferences
  getUserPreferences: async (token: string) => {
    return request('get_user_preferences', 'GET', undefined, token);
  },

  updateUserPreferences: async (token: string, preferences: { showFreelanceTab?: boolean; showPersonalTab?: boolean }) => {
    return request('update_user_preferences', 'POST', preferences, token);
  },

  // Gmail Integration
  gmail: {
    connect: async (token: string) => {
      const res = await fetch(`${API_BASE}/gmail/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!res.ok) throw new Error('Failed to get Gmail auth URL');
      return res.json();
    },
    status: async (token: string) => {
      const res = await fetch(`${API_BASE}/gmail/status`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to get Gmail status');
      return res.json();
    },
    scanNow: async (token: string, maxEmails = 50) => {
      const res = await fetch(`${API_BASE}/gmail/scan-now`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ maxEmails }),
      });
      if (!res.ok) throw new Error('Failed to scan emails');
      return res.json();
    },
    updateSettings: async (token: string, settings: { scanFrequency?: number; enabled?: boolean; promptInstructions?: string }) => {
      const res = await fetch(`${API_BASE}/gmail/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error('Failed to update Gmail settings');
      return res.json();
    },
    disconnect: async (token: string) => {
      const res = await fetch(`${API_BASE}/gmail/disconnect`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to disconnect Gmail');
      return res.json();
    },
    reply: async (token: string, data: { taskId: string; message: string; polishWithAI?: boolean; polishInstructions?: string }) => {
      const res = await fetch(`${API_BASE}/gmail/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to send email reply');
      return res.json();
    },
    polishReply: async (token: string, data: { message: string; instructions?: string }) => {
      const res = await fetch(`${API_BASE}/gmail/polish-reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to polish email reply');
      return res.json();
    },
    generateDraft: async (token: string, data: { taskId: string; tone?: string; customInstructions?: string }) => {
      const res = await fetch(`${API_BASE}/gmail/generate-draft`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to generate email draft');
      return res.json();
    },
  },

  // Slack Integration
  slack: {
    connect: async (token: string) => {
      const res = await fetch(`${API_BASE}/slack/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!res.ok) throw new Error('Failed to get Slack auth URL');
      return res.json();
    },
    status: async (token: string) => {
      const res = await fetch(`${API_BASE}/slack/status`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to get Slack status');
      return res.json();
    },
    scanNow: async (token: string, maxMentions = 50) => {
      const res = await fetch(`${API_BASE}/slack/scan-now`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ maxMentions }),
      });
      if (!res.ok) throw new Error('Failed to scan Slack mentions');
      return res.json();
    },
    updateSettings: async (token: string, settings: { scanFrequency?: number; enabled?: boolean; notificationsEnabled?: boolean }) => {
      const res = await fetch(`${API_BASE}/slack/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error('Failed to update Slack settings');
      return res.json();
    },
    disconnect: async (token: string) => {
      const res = await fetch(`${API_BASE}/slack/disconnect`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to disconnect Slack');
      return res.json();
    },
    dailySummary: async (token: string, tasks: Task[], dateLabel: string) => {
      const res = await fetch(`${API_BASE}/slack/daily-summary`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ tasks, dateLabel }),
      });
      if (!res.ok) throw new Error('Failed to post Slack daily summary');
      return res.json();
    },
  },

  // Telegram Integration
  telegram: {
    getLinkCode: async (token: string) => {
      const res = await fetch(`${API_BASE}/telegram/link-code`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to get link code');
      return res.json();
    },
    status: async (token: string) => {
      const res = await fetch(`${API_BASE}/telegram/status`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to get Telegram status');
      return res.json();
    },
    updateSettings: async (token: string, settings: { notificationsEnabled?: boolean; dailySummaryTime?: string }) => {
      const res = await fetch(`${API_BASE}/telegram/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error('Failed to update Telegram settings');
      return res.json();
    },
    unlink: async (token: string) => {
      const res = await fetch(`${API_BASE}/telegram/unlink`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to unlink Telegram');
      return res.json();
    },
  },

  // Draft Tasks
  draftTasks: {
    getAll: async (token: string, status = 'pending'): Promise<DraftTask[]> => {
      const res = await fetch(`${API_BASE}/draft-tasks?status=${status}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to get draft tasks');
      return res.json();
    },
    getOne: async (token: string, id: number): Promise<DraftTask> => {
      const res = await fetch(`${API_BASE}/draft-tasks/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to get draft task');
      return res.json();
    },
    approve: async (token: string, id: number, edits?: Partial<DraftTask>) => {
      const res = await fetch(`${API_BASE}/draft-tasks/${id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(edits || {}),
      });
      if (!res.ok) throw new Error('Failed to approve draft task');
      return res.json();
    },
    reject: async (token: string, id: number) => {
      const res = await fetch(`${API_BASE}/draft-tasks/${id}/reject`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to reject draft task');
      return res.json();
    },
    edit: async (token: string, id: number, edits: Partial<DraftTask>): Promise<DraftTask> => {
      const res = await fetch(`${API_BASE}/draft-tasks/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(edits),
      });
      if (!res.ok) throw new Error('Failed to edit draft task');
      return res.json();
    },
    delete: async (token: string, id: number) => {
      const res = await fetch(`${API_BASE}/draft-tasks/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to delete draft task');
      return res.json();
    },
    bulkApprove: async (token: string, draftIds: number[]) => {
      const res = await fetch(`${API_BASE}/draft-tasks/bulk-approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ draftIds }),
      });
      if (!res.ok) throw new Error('Failed to bulk approve draft tasks');
      return res.json();
    },
    bulkReject: async (token: string, draftIds: number[]) => {
      const res = await fetch(`${API_BASE}/draft-tasks/bulk-reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ draftIds }),
      });
      if (!res.ok) throw new Error('Failed to bulk reject draft tasks');
      return res.json();
    },
  },
};
