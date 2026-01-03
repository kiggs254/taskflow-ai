
import { Task, User, UserStats } from '../types';

// Updated to the exact link provided. 
const API_BASE = 'https://yellow-salmon-323871.hostingersite.com/tskapi.php';

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

  completeTask: async (token: string, id: string) => {
    return request('complete_task', 'POST', { id }, token);
  },
  
  uncompleteTask: async (token: string, id: string) => {
    return request('uncomplete_task', 'POST', { id }, token);
  },

  // Misc
  dailyReset: async (token: string) => {
    return request('daily_reset', 'POST', {}, token);
  }
};
