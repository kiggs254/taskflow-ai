
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

// --- Session-expiry handling -------------------------------------------------
//
// The auth token is a 7-day HMAC. When it lapses, every authenticated call returns
// 401, and the app used to just keep retrying on each 15s poll -- flooding the console
// with "Token Expired" and never recovering. This detects a 401 on ANY endpoint and
// signals the app once, so it can log out cleanly and show the login screen.
//
// `fetch` is shadowed for this whole module below, so both the request() helper and
// every direct api.* fetch route through one place -- there's no per-endpoint 401
// handling to add or forget.
type SessionExpiredHandler = () => void;
let sessionExpiredHandler: SessionExpiredHandler | null = null;
let sessionExpiredFired = false;

/** Register the callback that runs the first time a request 401s. */
export const onSessionExpired = (handler: SessionExpiredHandler): void => {
  sessionExpiredHandler = handler;
};

const nativeFetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis);

const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const res = await nativeFetch(input, init);
  if (res.status === 401) {
    // Fire once: 20 concurrent polls all 401'ing must not trigger 20 logouts.
    if (!sessionExpiredFired) {
      sessionExpiredFired = true;
      sessionExpiredHandler?.();
    }
  } else if (res.ok) {
    // A success means the session is valid again (e.g. after re-login), so re-arm so a
    // later expiry fires the handler afresh.
    sessionExpiredFired = false;
  }
  return res;
};

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
    const url = `${API_BASE}?action=${action}`;
    const res = await fetch(url, config);
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

    let data;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      console.error(`Failed to parse JSON response for ${action}:`, text.substring(0, 200));
      throw new Error(`Invalid response from server: ${text.substring(0, 100)}`);
    }
    
    if (!res.ok) {
      // Extract error message from response
      const errorMessage = data?.error || `Request failed with status ${res.status}`;
      console.error(`API Error (${action}):`, {
        status: res.status,
        statusText: res.statusText,
        error: errorMessage,
        response: data,
        fullResponse: text
      });
      // For 401 errors, provide more context
      if (res.status === 401) {
        throw new Error(errorMessage || 'Unauthorized - Please check your credentials');
      }
      throw new Error(errorMessage);
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
  forgotPassword: async (email: string) => {
    return request('forgot_password', 'POST', { email });
  },
  resetPassword: async (token: string, password: string) => {
    return request('reset_password', 'POST', { token, password });
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
    generateDraft: async (token: string, data: { taskId: string; message: string; style: 'short' | 'detailed' }) => {
      try {
        const url = `${API_BASE}/gmail/generate-draft`;
        console.log('Calling generate-draft API:', { url, taskId: data.taskId, hasToken: !!token });
        
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(data),
        });
        
        if (!res.ok) {
          let errorMessage = 'Failed to generate email draft';
          try {
            const errorData = await res.json();
            errorMessage = errorData.error || errorMessage;
            console.error('API error response:', { status: res.status, error: errorData });
          } catch (e) {
            const text = await res.text();
            console.error('API error (non-JSON):', { status: res.status, text });
            errorMessage = `Failed to generate email draft (${res.status}): ${text.substring(0, 100)}`;
          }
          throw new Error(errorMessage);
        }
        
        const result = await res.json();
        console.log('Generate-draft API success:', { hasDraft: !!result.draft });
        return result;
      } catch (error) {
        console.error('Generate-draft API call failed:', error);
        throw error;
      }
    },
  },

  // Claude Code agent logging
  agent: {
    settings: async (token: string) => {
      const res = await fetch(`${API_BASE}/agent/settings`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load agent settings');
      return res.json();
    },
    updateSettings: async (token: string, settings: { enabled?: boolean; workPaths?: { path: string; workspace: string }[] }) => {
      const res = await fetch(`${API_BASE}/agent/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error('Failed to save agent settings');
      return res.json();
    },
    tokens: async (token: string) => {
      const res = await fetch(`${API_BASE}/agent/tokens`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load tokens');
      return res.json();
    },
    createToken: async (token: string, name: string) => {
      const res = await fetch(`${API_BASE}/agent/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error('Failed to create token');
      return res.json();
    },
    revokeToken: async (token: string, id: number) => {
      const res = await fetch(`${API_BASE}/agent/tokens/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to revoke token');
      return res.json();
    },
  },

  // Analytics
  analytics: {
    summary: async (token: string, range: string) => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(`${API_BASE}/analytics/summary?range=${range}&tz=${encodeURIComponent(tz)}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load analytics');
      return res.json();
    },
    narrative: async (token: string, range: string) => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(`${API_BASE}/analytics/narrative?range=${range}&tz=${encodeURIComponent(tz)}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load insights');
      return res.json();
    },
  },

  // Daily report
  reports: {
    settings: async (token: string) => {
      const res = await fetch(`${API_BASE}/reports/settings`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load report settings');
      return res.json();
    },
    updateSettings: async (token: string, settings: Record<string, unknown>) => {
      const res = await fetch(`${API_BASE}/reports/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error('Failed to save report settings');
      return res.json();
    },
    completedToday: async (token: string) => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(`${API_BASE}/reports/completed-today?tz=${encodeURIComponent(tz)}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load today\'s report');
      return res.json();
    },
    sendNow: async (token: string) => {
      const res = await fetch(`${API_BASE}/reports/send-now`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ force: true }),
      });
      if (!res.ok) throw new Error('Failed to send test report');
      return res.json();
    },
  },

  // GitHub Integration
  github: {
    connect: async (token: string) => {
      const res = await fetch(`${API_BASE}/github/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to get GitHub auth URL');
      }
      return res.json();
    },
    status: async (token: string) => {
      const res = await fetch(`${API_BASE}/github/status`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to get GitHub status');
      return res.json();
    },
    refreshRepos: async (token: string) => {
      const res = await fetch(`${API_BASE}/github/repos?refresh=1`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to refresh repositories');
      return res.json();
    },
    setRepos: async (token: string, repoIds: number[]) => {
      const res = await fetch(`${API_BASE}/github/repos`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ repoIds }),
      });
      if (!res.ok) throw new Error('Failed to update tracked repos');
      return res.json();
    },
    scanNow: async (token: string) => {
      const res = await fetch(`${API_BASE}/github/scan-now`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      if (!res.ok) throw new Error('Failed to scan GitHub');
      return res.json();
    },
    updateSettings: async (token: string, settings: { scanFrequency?: number; enabled?: boolean }) => {
      const res = await fetch(`${API_BASE}/github/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error('Failed to update GitHub settings');
      return res.json();
    },
    disconnect: async (token: string) => {
      const res = await fetch(`${API_BASE}/github/disconnect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!res.ok) throw new Error('Failed to disconnect GitHub');
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
    updateSettings: async (token: string, settings: { scanFrequency?: number; enabled?: boolean; notificationsEnabled?: boolean; dailyReportEnabled?: boolean }) => {
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
