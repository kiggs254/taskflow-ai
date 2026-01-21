

export type WorkspaceType = 'job' | 'freelance' | 'personal';

export type EnergyLevel = 'high' | 'medium' | 'low';

export type TaskStatus = 'todo' | 'in-progress' | 'waiting' | 'done';

export interface User {
  id: number;
  username: string;
  email: string;
  token?: string;
  last_reset_at?: string; // New field from backend
}

export interface RecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly';
  interval: number; // e.g., every 1 week, every 2 days
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  workspace: WorkspaceType;
  energy: EnergyLevel;
  status: TaskStatus;
  estimatedTime?: number; // in minutes
  tags: string[];
  dependencies?: string[]; // Array of Task IDs
  createdAt: number;
  completedAt?: number;
  dueDate?: number;
  snoozedUntil?: number; // Timestamp until which the task is hidden
  recurrence?: RecurrenceRule;
  originalRecurrenceId?: string; // Links recurring tasks together
}

export interface UserStats {
  xp: number;
  level: number;
  streak: number;
  completedToday: number;
}

export enum AppView {
  DASHBOARD = 'DASHBOARD',
  FOCUS_MODE = 'FOCUS_MODE',
  DAILY_RESET = 'DAILY_RESET',
  ANALYTICS = 'ANALYTICS',
  SETTINGS = 'SETTINGS',
  COMPLETED_TASKS = 'COMPLETED_TASKS',
  DRAFT_TASKS = 'DRAFT_TASKS',
  MEETINGS = 'MEETINGS',
}

export interface AIParsedTask {
  title: string;
  energy: EnergyLevel;
  estimatedTime: number;
  tags: string[];
  workspaceSuggestions?: WorkspaceType;
}

export interface DraftTask {
  id: number;
  userId: number;
  source: 'gmail' | 'telegram' | 'slack';
  sourceId?: string;
  title: string;
  description?: string;
  workspace?: WorkspaceType;
  energy?: EnergyLevel;
  estimatedTime?: number;
  tags: string[];
  dueDate?: number;
  status: 'pending' | 'approved' | 'rejected';
  aiConfidence?: number;
  createdAt: string;
}