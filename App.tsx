import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Plus, Brain, Zap, Coffee, Briefcase, User, Laptop, CheckCircle2, Play, 
  X, Menu, Trophy, Flame, ArrowRight, Sparkles, Target, Clock, Layout, 
  Sun, Moon, RotateCcw, MessageSquare, Copy, Check, Mail, Lock, Unlock,
  LogOut, Loader2, Link as LinkIcon, BarChart2, Settings as SettingsIcon,
  PieChart, Bell, Volume2, Shield, Palette, ArrowLeft, Pencil, Save, Filter,
  Search, Command, MoreVertical, Hourglass, AlarmClockOff,
  Calendar, ArrowUpDown, Download, Clipboard, Repeat, CheckSquare
} from 'lucide-react';
import { 
  Task, WorkspaceType, UserStats, AppView, User as UserType, EnergyLevel, RecurrenceRule
} from './types';
import { DraftTasksView } from './components/DraftTasksView';
import { GmailSettings } from './components/GmailSettings';
import { TelegramSettings } from './components/TelegramSettings';
import { SlackSettings } from './components/SlackSettings';
import { TaskDetailModal } from './components/TaskDetailModal';
import { ToastContainer, Toast, ToastType } from './components/ToastNotification';
import { ConfirmationModal } from './components/ConfirmationModal';
import { AlertModal } from './components/AlertModal';
import { 
  parseTaskWithGemini, 
  getDailyMotivation, 
  generateDailyPlan,
  generateClientFollowUp
} from './services/geminiService';
import { api } from './services/apiService';

// --- Sound Utils ---
const playSound = (type: 'complete' | 'levelUp') => {
  if (localStorage.getItem('tf_sounds') === 'false') return;

  const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContext) return;

  const ctx = new AudioContext();
  const gainNode = ctx.createGain();
  gainNode.connect(ctx.destination);

  if (type === 'complete') {
    // Satisfying "Ping"
    const osc = ctx.createOscillator();
    osc.connect(gainNode);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1); // A5
    
    gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } else if (type === 'levelUp') {
    // Victory Fanfare
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => { // C Major Arpeggio
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.connect(oscGain);
      oscGain.connect(ctx.destination);
      
      osc.type = 'triangle';
      osc.frequency.value = freq;
      
      const startTime = now + i * 0.1;
      oscGain.gain.setValueAtTime(0, startTime);
      oscGain.gain.linearRampToValueAtTime(0.1, startTime + 0.05);
      oscGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.8);
      
      osc.start(startTime);
      osc.stop(startTime + 0.8);
    });
  }
};

// --- Components ---

const AuthScreen = ({ onLogin }: { onLogin: (user: UserType, token: string, stats: UserStats) => void }) => {
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      let res;
      if (isRegister) {
        res = await api.register(formData.username, formData.email, formData.password);
      } else {
        res = await api.login(formData.email, formData.password);
      }
      
      if (res.success) {
        const stats: UserStats = {
          xp: res.user.xp,
          level: res.user.level,
          streak: res.user.streak,
          completedToday: 0 // Will be calculated from tasks
        };
        onLogin(res.user, res.token, stats);
      }
    } catch (err: any) {
      let msg = err.message || 'Authentication failed';
      if (msg === 'Failed to fetch') {
        msg = 'Connection failed. Check your internet or API URL.';
      } else if (msg.includes('Server Error')) {
        msg = 'Server Error. Is the backend URL correct?';
      } else if (msg.includes('Unexpected token')) {
        msg = 'Invalid response from server. Check API configuration.';
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-blue-600 shadow-xl shadow-primary/20 mb-4">
            <Brain className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">TASKFLOW.AI</h1>
          <p className="text-slate-400 mt-2">Neuro-friendly task management for devs.</p>
        </div>

        <div className="bg-surface border border-slate-700 p-8 rounded-2xl shadow-2xl">
          <h2 className="text-xl font-semibold text-white mb-6">
            {isRegister ? 'Create Account' : 'Welcome Back'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegister && (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Username</label>
                <input 
                  type="text" 
                  required
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:border-primary transition-colors"
                  value={formData.username}
                  onChange={e => setFormData({...formData, username: e.target.value})}
                />
              </div>
            )}
            
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Email</label>
              <input 
                type="email" 
                required
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:border-primary transition-colors"
                value={formData.email}
                onChange={e => setFormData({...formData, email: e.target.value})}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Password</label>
              <input 
                type="password" 
                required
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:border-primary transition-colors"
                value={formData.password}
                onChange={e => setFormData({...formData, password: e.target.value})}
              />
            </div>

            {error && (
              <div className="p-3 bg-red-900/20 border border-red-900/50 rounded-lg text-red-400 text-sm">
                {error}
              </div>
            )}

            <button 
              type="submit" 
              disabled={loading}
              className="w-full py-3 bg-primary hover:bg-blue-600 text-white font-bold rounded-lg transition-all flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {isRegister ? 'Start Flowing' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button 
              onClick={() => { setIsRegister(!isRegister); setError(''); }}
              className="text-sm text-slate-400 hover:text-white transition-colors"
            >
              {isRegister ? 'Already have an account? Sign in' : "Don't have an account? Create one"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const DueDateDisplay = ({ dueDate }: { dueDate?: number }) => {
  if (!dueDate) return null;

  const date = new Date(dueDate);
  const today = new Date();
  today.setHours(0,0,0,0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  let color = 'text-slate-500';
  let text = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  if (date < today) {
    color = 'text-red-400';
    text = 'Overdue';
  } else if (date.toDateString() === today.toDateString()) {
    color = 'text-orange-400';
    text = 'Today';
  } else if (date.toDateString() === tomorrow.toDateString()) {
    color = 'text-yellow-500';
    text = 'Tomorrow';
  }

  return (
    <span className={`flex items-center gap-1 text-xs font-medium ${color}`}>
      <Calendar className="w-3 h-3" /> {text}
    </span>
  );
};

const TaskCard: React.FC<{ 
  task: Task; 
  blockingTasks: Task[];
  token: string;
  onComplete: (id: string) => void;
  onUpdate: (task: Task) => void;
  onStartFocus: (task: Task) => void;
  onAddDependency: (taskId: string) => void;
  onRemoveDependency: (taskId: string, dependencyId: string) => void;
  onDelete: (id: string) => void;
  onSnooze: (id: string, duration: 'hour' | 'day' | 'week') => void;
  onSetWaiting: (id: string) => void;
}> = ({ 
  task, 
  blockingTasks,
  token,
  onComplete, 
  onUpdate,
  onStartFocus,
  onAddDependency,
  onRemoveDependency,
  onDelete,
  onSnooze,
  onSetWaiting,
  onViewDetails
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editEnergy, setEditEnergy] = useState<EnergyLevel>(task.energy);
  const [editWorkspace, setEditWorkspace] = useState<WorkspaceType>(task.workspace);
  const [editDueDate, setEditDueDate] = useState(task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : '');
  const [editRecurrence, setEditRecurrence] = useState<RecurrenceRule | undefined>(task.recurrence);


  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUpText, setFollowUpText] = useState('');
  const [loadingFollowUp, setLoadingFollowUp] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  const isBlocked = blockingTasks.length > 0;

  const energyColors = {
    high: 'border-l-accent bg-accent/5',
    medium: 'border-l-warning bg-warning/5',
    low: 'border-l-success bg-success/5',
  };

  const energyIcons = {
    high: <Zap className="w-4 h-4 text-accent" />,
    medium: <Brain className="w-4 h-4 text-warning" />,
    low: <Coffee className="w-4 h-4 text-success" />,
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(event.target as Node)) {
        setShowActions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleGenerateFollowUp = async () => {
    if (followUpText) {
      setShowFollowUp(!showFollowUp);
      return;
    }
    setLoadingFollowUp(true);
    setShowFollowUp(true);
    const text = await generateClientFollowUp(task.title, token);
    setFollowUpText(text);
    setLoadingFollowUp(false);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(followUpText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getMailtoLink = () => {
    const subject = encodeURIComponent(`Update: ${task.title}`);
    const body = encodeURIComponent(followUpText);
    return `mailto:?subject=${subject}&body=${body}`;
  };

  const handleSave = () => {
    const newDueDate = editDueDate ? new Date(`${editDueDate}T12:00:00Z`).getTime() : undefined;
    onUpdate({
      ...task,
      title: editTitle,
      energy: editEnergy,
      workspace: editWorkspace,
      dueDate: newDueDate,
      recurrence: editRecurrence
    });
    setIsEditing(false);
  };
  
  const handleRecurrenceChange = (key: keyof RecurrenceRule, value: any) => {
    const newRec: RecurrenceRule = editRecurrence || { frequency: 'weekly', interval: 1 };
    if (key === 'interval') {
       newRec.interval = parseInt(value, 10) || 1;
    } else {
       (newRec as any)[key] = value;
    }
    setEditRecurrence(newRec);
  }

  if (isEditing) {
    return (
      <div className="p-4 rounded-xl bg-surface border border-primary border-l-4 mb-3 shadow-lg">
        <div className="space-y-3">
          <input 
            type="text" 
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-white focus:border-primary focus:outline-none"
            autoFocus
          />
          <div className="flex flex-wrap gap-2 items-center">
            <select 
              value={editEnergy} 
              onChange={(e) => setEditEnergy(e.target.value as EnergyLevel)}
              className="bg-slate-800 border border-slate-700 rounded p-2 text-sm text-slate-300 focus:outline-none"
            >
              <option value="high">High Energy</option>
              <option value="medium">Medium Energy</option>
              <option value="low">Low Energy</option>
            </select>
             <select 
              value={editWorkspace} 
              onChange={(e) => setEditWorkspace(e.target.value as WorkspaceType)}
              className="bg-slate-800 border border-slate-700 rounded p-2 text-sm text-slate-300 focus:outline-none"
            >
              <option value="job">Job</option>
              <option value="freelance">Freelance</option>
              <option value="personal">Personal</option>
            </select>
             <div className="relative">
                <input 
                  type="date" 
                  value={editDueDate} 
                  onChange={(e) => setEditDueDate(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded p-2 text-sm text-slate-300 focus:outline-none appearance-none"
                  style={{ colorScheme: 'dark' }}
                />
                <Calendar className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              </div>
          </div>
          {/* Recurrence Editor */}
           <div className="pt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!editRecurrence}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setEditRecurrence({ frequency: 'weekly', interval: 1 });
                    } else {
                      setEditRecurrence(undefined);
                    }
                  }}
                  className="form-checkbox h-4 w-4 rounded bg-slate-700 border-slate-600 text-primary focus:ring-primary"
                />
                <span className="text-sm text-slate-300">Repeat task</span>
              </label>
            
              {editRecurrence && (
                <div className="mt-2 pl-6 flex items-center gap-2 text-sm animate-in fade-in">
                  <span>Every</span>
                  <input
                    type="number"
                    min="1"
                    value={editRecurrence.interval}
                    onChange={(e) => handleRecurrenceChange('interval', e.target.value)}
                    className="w-16 bg-slate-800 border border-slate-700 rounded p-1 text-center"
                  />
                  <select
                    value={editRecurrence.frequency}
                    onChange={(e) => handleRecurrenceChange('frequency', e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded p-1 text-slate-300 focus:outline-none"
                  >
                    <option value="daily">day(s)</option>
                    <option value="weekly">week(s)</option>
                    <option value="monthly">month(s)</option>
                  </select>
                </div>
              )}
            </div>
          <div className="flex justify-end gap-2 pt-2">
             <button onClick={() => setIsEditing(false)} className="px-3 py-1 rounded text-sm text-slate-400 hover:bg-slate-800">Cancel</button>
             <button onClick={handleSave} className="px-3 py-1 rounded text-sm bg-primary text-white flex items-center gap-1">
               <Save className="w-3 h-3" /> Save
             </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className={`group relative p-4 rounded-xl bg-surface border transition-all border-l-4 mb-3 shadow-sm cursor-pointer
        ${energyColors[task.energy]} 
        ${isBlocked || task.status === 'waiting' ? 'opacity-60 border-slate-700 bg-slate-800/50' : 'border-slate-700/50 hover:border-slate-600'}`}
      onClick={() => onViewDetails(task)}
    >
      
      {isBlocked && (
        <div className="absolute top-2 right-2 text-slate-500">
          <Lock className="w-4 h-4" />
        </div>
      )}
      
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button 
          onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
          className="text-slate-500 hover:text-white p-1"
          title="Edit Task"
        >
          <Pencil className="w-4 h-4" />
        </button>
         <div className="relative" ref={actionsRef}>
           <button 
             onClick={(e) => { e.stopPropagation(); setShowActions(!showActions); }}
             className="text-slate-500 hover:text-white p-1"
             title="More actions"
           >
             <MoreVertical className="w-4 h-4" />
           </button>
           {showActions && (
             <div className="absolute top-full right-0 mt-2 w-48 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-20 py-1">
               <button 
                 onClick={(e) => { 
                   e.stopPropagation(); 
                   setShowActions(false); 
                   onSetWaiting(task.id);
                 }} 
                 className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 flex items-center gap-2"
               >
                 <Hourglass className="w-4 h-4" /> {task.status === 'waiting' ? 'Clear Waiting' : 'Mark as Waiting'}
               </button>
               <div className="px-3 py-1 text-xs text-slate-500">Snooze...</div>
               <button 
                 onClick={(e) => { 
                   e.stopPropagation(); 
                   setShowActions(false); 
                   onSnooze(task.id, 'hour'); 
                 }} 
                 className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 flex items-center gap-2"
               >
                 <AlarmClockOff className="w-4 h-4" /> For 1 Hour
               </button>
                <button 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    setShowActions(false); 
                    onSnooze(task.id, 'day'); 
                  }} 
                  className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 flex items-center gap-2"
                >
                 <Sun className="w-4 h-4" /> Until Tomorrow
               </button>
                <button 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    setShowActions(false); 
                    onSnooze(task.id, 'week'); 
                  }} 
                  className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 flex items-center gap-2"
                >
                 <Calendar className="w-4 h-4" /> Until Next Week
               </button>
               <div className="h-px bg-slate-700 my-1" />
               <button 
                 onClick={(e) => { 
                   e.stopPropagation(); 
                   setShowActions(false); 
                   onDelete(task.id); 
                 }}
                 className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-slate-700 flex items-center gap-2"
               >
                 <X className="w-4 h-4" /> Delete Task
               </button>
             </div>
           )}
         </div>
      </div>

      <div className="flex justify-between items-start">
        <div className="flex-1 pr-12">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1">
            {energyIcons[task.energy]}
            <span className="text-xs uppercase tracking-wider font-semibold text-slate-400 opacity-75">{task.energy} Energy</span>
             {task.status === 'waiting' && (
              <span className="text-xs text-amber-400 flex items-center gap-1">
                <Hourglass className="w-3 h-3" /> Waiting
              </span>
            )}
            <DueDateDisplay dueDate={task.dueDate} />
            {task.tags.includes('meeting') && task.dueDate && (
              <span className="text-xs text-violet-300 flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-900/40 border border-violet-500/40">
                <Calendar className="w-3 h-3" /> Meeting {new Date(task.dueDate).toLocaleString()}
              </span>
            )}
            {task.recurrence && (
              <span className="text-xs text-slate-500 flex items-center gap-1">
                <Repeat className="w-3 h-3" /> Repeats
              </span>
            )}
          </div>
          
          <h3 className={`font-medium text-lg leading-tight mb-2 ${isBlocked || task.status === 'waiting' ? 'text-slate-400' : 'text-slate-100'}`}>
            {task.title}
          </h3>
          
          <div className="flex flex-wrap gap-2">
            {task.tags.map(tag => (
              <span key={tag} className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 text-xs border border-slate-700">
                #{tag}
              </span>
            ))}
            
            {blockingTasks.map(blocker => (
              <button
                key={blocker.id}
                onClick={() => onRemoveDependency(task.id, blocker.id)}
                className="px-2 py-0.5 rounded-md bg-red-900/20 text-red-400 text-xs border border-red-900/30 flex items-center gap-1 hover:bg-red-900/40 hover:line-through transition-colors"
                title="Click to remove dependency"
              >
                <Lock className="w-3 h-3" /> Blocked by: {blocker.title.substring(0, 15)}{blocker.title.length > 15 ? '...' : ''}
              </button>
            ))}

            {task.workspace === 'freelance' && (
               <button 
               onClick={handleGenerateFollowUp}
               className="px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 text-xs border border-blue-500/20 hover:bg-blue-500/20 flex items-center gap-1 transition-colors"
             >
               <MessageSquare className="w-3 h-3" /> Client Draft
             </button>
            )}

            <button
               onClick={() => onAddDependency(task.id)}
               className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-500 text-xs border border-slate-700 hover:bg-slate-700 hover:text-slate-300 flex items-center gap-1 transition-colors opacity-0 group-hover:opacity-100"
               title="Add Dependency"
            >
              <LinkIcon className="w-3 h-3" /> Link
            </button>
          </div>

          {showFollowUp && (
            <div className="mt-3 p-3 bg-slate-800/50 rounded-lg border border-slate-700 animate-in slide-in-from-top-2">
              <div className="flex flex-col gap-2">
                <div className="relative">
                   <p className="text-sm text-slate-300 italic p-2 bg-slate-900/50 rounded border border-slate-700/50">
                    {loadingFollowUp ? <span className="animate-pulse">Generating draft...</span> : `"${followUpText}"`}
                  </p>
                </div>
                
                {!loadingFollowUp && (
                  <div className="flex gap-2 justify-end">
                    <button 
                      onClick={copyToClipboard} 
                      className="px-3 py-1.5 rounded text-xs bg-slate-700 hover:bg-slate-600 text-white flex items-center gap-2"
                    >
                      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                    <a 
                      href={getMailtoLink()}
                      className="px-3 py-1.5 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-2"
                    >
                      <Mail className="w-3 h-3" />
                      Open Email
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
        
        <div className={`flex flex-col gap-2 transition-opacity pl-4 ${isBlocked || task.status === 'waiting' ? 'opacity-20 pointer-events-none' : 'opacity-100 sm:opacity-0 group-hover:opacity-100'}`}>
           <button 
            onClick={(e) => { e.stopPropagation(); onStartFocus(task); }}
            className="p-2 rounded-lg bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white transition-colors"
            title="Focus Mode"
          >
            <Play className="w-5 h-5" />
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); onComplete(task.id); }}
            className="p-2 rounded-lg bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600 hover:text-white transition-colors"
            title="Complete"
          >
            <CheckCircle2 className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

const WorkspaceTab = ({ 
  active, 
  type, 
  onClick, 
  icon 
}: { 
  active: boolean; 
  type: string; 
  onClick: () => void; 
  icon: React.ReactNode 
}) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
      active 
        ? 'bg-primary text-white shadow-lg shadow-primary/25 scale-105' 
        : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
    }`}
  >
    {icon}
    <span className="capitalize">{type}</span>
  </button>
);

const FocusOverlay = ({ 
  task, 
  onExit, 
  onComplete 
}: { 
  task: Task; 
  onExit: () => void; 
  onComplete: () => void 
}) => {
  const [timeLeft, setTimeLeft] = useState((task.estimatedTime || 25) * 60);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    let interval: any;
    if (isActive && timeLeft > 0) {
      interval = setInterval(() => setTimeLeft((t) => t - 1), 1000);
    } else if (timeLeft === 0) {
      setIsActive(false);
    }
    return () => clearInterval(interval);
  }, [isActive, timeLeft]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center p-6 animate-in fade-in duration-300">
      <div className="absolute top-6 right-6">
        <button 
          onClick={onExit}
          className="p-3 rounded-full bg-surface text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="max-w-2xl w-full text-center space-y-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent text-sm font-medium tracking-wide">
          <Target className="w-4 h-4" /> FOCUS MODE
        </div>
        
        <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight">
          {task.title}
        </h1>

        <div className="font-mono text-7xl md:text-9xl font-bold text-slate-200 tracking-tighter">
          {formatTime(timeLeft)}
        </div>

        <div className="flex gap-4 justify-center pt-8">
          <button
            onClick={() => setIsActive(!isActive)}
            className={`px-8 py-4 rounded-xl text-lg font-bold transition-all ${
              isActive 
                ? 'bg-slate-700 text-slate-200 hover:bg-slate-600' 
                : 'bg-primary text-white shadow-xl shadow-primary/20 hover:scale-105'
            }`}
          >
            {isActive ? 'Pause Timer' : 'Start Focus'}
          </button>
          
          <button
            onClick={onComplete}
            className="px-8 py-4 rounded-xl text-lg font-bold bg-emerald-600 text-white shadow-xl shadow-emerald-500/20 hover:bg-emerald-500 hover:scale-105 transition-all flex items-center gap-2"
          >
            <CheckCircle2 className="w-6 h-6" />
            Task Complete
          </button>
        </div>
        
        <p className="text-slate-500 animate-pulse-slow">
          Everything else is hidden. Just do this one thing.
        </p>
      </div>
    </div>
  );
};

const LevelUpModal = ({ 
  level, 
  onClose 
}: { 
  level: number; 
  onClose: () => void 
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 p-1 rounded-2xl shadow-2xl animate-pop-in max-w-sm w-full relative overflow-hidden">
        {/* Shimmer Effect */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-12 animate-shimmer" />
        
        <div className="bg-surface rounded-xl p-8 text-center relative z-10 flex flex-col items-center">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center mb-6 shadow-xl shadow-orange-500/40">
            <Trophy className="w-12 h-12 text-white" />
          </div>
          
          <h2 className="text-3xl font-black text-white mb-2 tracking-tight">LEVEL UP!</h2>
          <p className="text-slate-400 mb-6">You are now a <span className="text-primary font-bold">Level {level}</span> Developer.</p>
          
          <div className="grid grid-cols-2 gap-3 w-full mb-6">
            <div className="bg-slate-800 p-3 rounded-lg text-center">
              <div className="text-xs text-slate-500 uppercase">Focus</div>
              <div className="font-bold text-white">+5%</div>
            </div>
            <div className="bg-slate-800 p-3 rounded-lg text-center">
              <div className="text-xs text-slate-500 uppercase">Energy</div>
              <div className="font-bold text-white">MAX</div>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="w-full py-3 bg-white text-slate-900 font-bold rounded-lg hover:bg-slate-200 transition-colors"
          >
            Claim Rewards
          </button>
        </div>
      </div>
    </div>
  );
};

const DailyReset = ({
  completedTasks,
  pendingTasks,
  token,
  onClose,
  onExport,
}: {
  completedTasks: Task[];
  pendingTasks: Task[];
  token: string;
  onClose: () => void;
  onExport: (format: 'csv' | 'md', tasks: Task[]) => void;
}) => {
  const [aiPlan, setAiPlan] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (token) {
      generateDailyPlan(pendingTasks, token).then(plan => {
        setAiPlan(plan);
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, [pendingTasks, token]);

  const completedJobTasks = completedTasks.filter(t => t.workspace === 'job');

  const handleCopyMarkdown = () => {
    onExport('md', completedJobTasks);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  return (
    <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col items-center justify-center p-6 animate-in fade-in duration-500 overflow-y-auto">
      <div className="max-w-2xl w-full space-y-6 relative py-12">
        <div className="text-center space-y-2">
          <div className="inline-block p-4 rounded-full bg-primary/20 mb-4">
             <RotateCcw className="w-10 h-10 text-primary animate-spin-slow" style={{ animationDuration: '3s' }} />
          </div>
          <h1 className="text-4xl font-bold text-white">Day Complete</h1>
          <p className="text-slate-400">Time to reset and recharge for tomorrow.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-surface p-6 rounded-2xl border border-slate-700 text-center relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 opacity-10">
              <CheckCircle2 className="w-16 h-16" />
            </div>
            <div className="text-4xl font-bold text-emerald-400 mb-1">{completedTasks.length}</div>
            <div className="text-sm text-slate-400">Tasks Crushed</div>
          </div>
          <div className="bg-surface p-6 rounded-2xl border border-slate-700 text-center relative overflow-hidden">
             <div className="absolute top-0 right-0 p-3 opacity-10">
              <ArrowRight className="w-16 h-16" />
            </div>
            <div className="text-4xl font-bold text-orange-400 mb-1">{pendingTasks.length}</div>
            <div className="text-sm text-slate-400">Moved to Tomorrow</div>
          </div>
        </div>

        {completedTasks.length > 0 && (
          <div className="bg-surface/30 p-4 rounded-xl border border-slate-700/30">
             <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Today's Wins</h4>
             <ul className="space-y-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                {completedTasks.map(task => (
                  <li key={task.id} className="flex items-center gap-2 text-slate-300 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500/50" />
                    <span className="line-through opacity-75">{task.title}</span>
                  </li>
                ))}
             </ul>
          </div>
        )}

        {completedJobTasks.length > 0 && (
          <div className="bg-surface/30 p-4 rounded-xl border border-slate-700/30">
             <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Export Report (Job Tasks)</h4>
              <div className="flex gap-4">
                <button 
                  onClick={() => onExport('csv', completedJobTasks)}
                  className="flex-1 py-2 px-4 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm flex items-center justify-center gap-2 transition-colors"
                >
                  <Download className="w-4 h-4" /> Download CSV
                </button>
                 <button 
                  onClick={handleCopyMarkdown}
                  className="flex-1 py-2 px-4 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm flex items-center justify-center gap-2 transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-green-400" /> : <Clipboard className="w-4 h-4" />}
                  {copied ? 'Copied!' : 'Copy Markdown'}
                </button>
              </div>
          </div>
        )}

        <div className="bg-gradient-to-b from-surface to-slate-900 p-6 rounded-2xl border border-slate-700">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-white mb-4">
            <Brain className="w-5 h-5 text-purple-400" />
            Smart Plan for Tomorrow
          </h3>
          {loading ? (
             <div className="space-y-3">
               <div className="h-4 bg-slate-700 rounded w-3/4 animate-pulse" />
               <div className="h-4 bg-slate-700 rounded w-1/2 animate-pulse" />
               <div className="h-4 bg-slate-700 rounded w-5/6 animate-pulse" />
             </div>
          ) : (
            <div className="prose prose-invert text-slate-300 text-sm leading-relaxed whitespace-pre-line">
              {aiPlan}
            </div>
          )}
        </div>

        <p className="text-xs text-amber-300/80 text-center">
          Note: All unfinished tasks will be rolled over to tomorrow. A summary of today&apos;s Job tasks will be posted to <span className="font-semibold">#tech-team-daily-tasks</span>.
        </p>

        <button 
          onClick={onClose}
          className="w-full py-4 rounded-xl bg-gradient-to-r from-primary to-blue-600 text-white font-bold text-lg hover:scale-[1.02] transition-transform shadow-xl shadow-primary/20 flex items-center justify-center gap-2"
        >
          <Moon className="w-5 h-5" />
          Wrap Up & Rest
        </button>
      </div>
    </div>
  );
};

const QuickCapture = ({ 
  isOpen, 
  onClose, 
  onAdd 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  onAdd: (title: string, description?: string) => Promise<void>; 
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    
    setIsAnalyzing(true);
    await onAdd(title, description || undefined);
    setIsAnalyzing(false);
    setTitle('');
    setDescription('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-surface border border-slate-700 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title (e.g., Fix navbar bug)"
              className="w-full bg-transparent text-xl px-6 pt-4 pb-3 text-white placeholder-slate-500 focus:outline-none"
              disabled={isAnalyzing}
            />
          </div>
          <div className="px-6">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details / notes for this task"
              rows={3}
              className="w-full bg-slate-900/40 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-primary resize-y"
              disabled={isAnalyzing}
            />
          </div>
          <div className="px-6 pb-3 flex items-center justify-between gap-4 text-xs text-slate-500">
            <div className="flex gap-4">
              <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> AI Auto-tagging</span>
              <span className="flex items-center gap-1"><Layout className="w-3 h-3" /> Smart Sort</span>
            </div>
            <button 
              type="submit"
              disabled={isAnalyzing}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary text-white text-sm hover:bg-blue-600 disabled:opacity-60"
            >
              {isAnalyzing ? (
                <>
                  <Sparkles className="w-4 h-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <ArrowRight className="w-4 h-4" />
                  Add Task
                </>
              )}
            </button>
          </div>
        </form>
      </div>
      <div className="absolute inset-0 -z-10" onClick={onClose} />
    </div>
  );
};

const DependencyModal = ({
  task,
  potentialDependencies,
  onSelect,
  onClose
}: {
  task: Task;
  potentialDependencies: Task[];
  onSelect: (dependencyId: string) => void;
  onClose: () => void;
}) => {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-surface border border-slate-700 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-4 border-b border-slate-700 flex justify-between items-center">
          <h3 className="font-bold text-lg text-white">Add Dependency</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4">
           <p className="text-sm text-slate-400 mb-4">
             Select a task that must be completed <strong>before</strong> you can start <em>"{task.title}"</em>.
           </p>
           
           <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
             {potentialDependencies.length === 0 ? (
               <p className="text-center text-slate-500 py-4">No available tasks to link.</p>
             ) : (
               potentialDependencies.map(dep => (
                 <button
                   key={dep.id}
                   onClick={() => onSelect(dep.id)}
                   className="w-full p-3 rounded-lg border border-slate-700 bg-slate-800/50 hover:bg-slate-700 text-left transition-colors flex items-center justify-between group"
                 >
                   <span className="text-slate-300 text-sm truncate">{dep.title}</span>
                   <LinkIcon className="w-4 h-4 text-slate-500 group-hover:text-primary" />
                 </button>
               ))
             )}
           </div>
        </div>
      </div>
      <div className="absolute inset-0 -z-10" onClick={onClose} />
    </div>
  );
};

// --- Analytics Components ---

const AnalyticsScreen = ({ tasks, onBack }: { tasks: Task[], onBack: () => void }) => {
  const completedTasks = tasks.filter(t => t.status === 'done');
  const highEnergyDone = completedTasks.filter(t => t.energy === 'high').length;
  const medEnergyDone = completedTasks.filter(t => t.energy === 'medium').length;
  const lowEnergyDone = completedTasks.filter(t => t.energy === 'low').length;
  
  // Last 7 days chart data
  const getLast7DaysData = () => {
    const data = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dayStr = d.toDateString();
      const count = completedTasks.filter(t => t.completedAt && new Date(t.completedAt).toDateString() === dayStr).length;
      data.push({ day: d.toLocaleDateString('en-US', { weekday: 'short' }), count });
    }
    return data;
  };

  const weeklyData = getLast7DaysData();
  const maxVal = Math.max(...weeklyData.map(d => d.count), 1); // Avoid div by zero

  const totalEstimatedTime = completedTasks.reduce((acc, t) => acc + (t.estimatedTime || 0), 0);
  const hoursFocused = (totalEstimatedTime / 60).toFixed(1);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="md:hidden p-2 -ml-2 text-slate-400 hover:text-white rounded-full hover:bg-slate-800">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <BarChart2 className="w-6 h-6 text-primary" /> Analytics
        </h2>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-surface p-4 rounded-xl border border-slate-700">
          <div className="text-slate-400 text-xs uppercase mb-1">Total Completed</div>
          <div className="text-2xl font-bold text-white">{completedTasks.length}</div>
        </div>
        <div className="bg-surface p-4 rounded-xl border border-slate-700">
           <div className="text-slate-400 text-xs uppercase mb-1">Focus Hours</div>
           <div className="text-2xl font-bold text-emerald-400">{hoursFocused}h</div>
        </div>
        <div className="bg-surface p-4 rounded-xl border border-slate-700">
           <div className="text-slate-400 text-xs uppercase mb-1">High Energy</div>
           <div className="text-2xl font-bold text-accent">{highEnergyDone}</div>
        </div>
        <div className="bg-surface p-4 rounded-xl border border-slate-700">
           <div className="text-slate-400 text-xs uppercase mb-1">Completion Rate</div>
           <div className="text-2xl font-bold text-blue-400">
             {tasks.length > 0 ? Math.round((completedTasks.length / tasks.length) * 100) : 0}%
           </div>
        </div>
      </div>

      {/* Weekly Chart */}
      <div className="bg-surface p-6 rounded-xl border border-slate-700">
        <h3 className="text-sm font-semibold text-slate-400 mb-6 uppercase tracking-wider">Weekly Activity</h3>
        <div className="flex items-end justify-between h-40 gap-2">
          {weeklyData.map((d, i) => (
            <div key={i} className="flex flex-col items-center gap-2 w-full">
               <div className="w-full bg-slate-800 rounded-t-lg relative group overflow-hidden" style={{ height: '100%' }}>
                  <div 
                    className="absolute bottom-0 left-0 w-full bg-primary transition-all duration-1000 ease-out group-hover:bg-blue-400"
                    style={{ height: `${(d.count / maxVal) * 100}%` }}
                  />
               </div>
               <span className="text-xs text-slate-500">{d.day}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Energy Distribution */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-surface p-6 rounded-xl border border-slate-700">
          <h3 className="text-sm font-semibold text-slate-400 mb-6 uppercase tracking-wider">Energy Distribution</h3>
          <div className="space-y-4">
             <div className="flex items-center gap-3">
                <Zap className="w-5 h-5 text-accent" />
                <div className="flex-1 h-3 bg-slate-800 rounded-full overflow-hidden">
                   <div className="h-full bg-accent" style={{ width: `${(highEnergyDone / (completedTasks.length || 1)) * 100}%` }} />
                </div>
                <span className="text-sm text-slate-300 font-mono w-8 text-right">{highEnergyDone}</span>
             </div>
             <div className="flex items-center gap-3">
                <Brain className="w-5 h-5 text-warning" />
                <div className="flex-1 h-3 bg-slate-800 rounded-full overflow-hidden">
                   <div className="h-full bg-warning" style={{ width: `${(medEnergyDone / (completedTasks.length || 1)) * 100}%` }} />
                </div>
                <span className="text-sm text-slate-300 font-mono w-8 text-right">{medEnergyDone}</span>
             </div>
             <div className="flex items-center gap-3">
                <Coffee className="w-5 h-5 text-success" />
                <div className="flex-1 h-3 bg-slate-800 rounded-full overflow-hidden">
                   <div className="h-full bg-success" style={{ width: `${(lowEnergyDone / (completedTasks.length || 1)) * 100}%` }} />
                </div>
                <span className="text-sm text-slate-300 font-mono w-8 text-right">{lowEnergyDone}</span>
             </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-primary/20 to-surface border border-primary/20 p-6 rounded-xl flex flex-col justify-center items-center text-center">
            <Trophy className="w-12 h-12 text-yellow-400 mb-3" />
            <h3 className="text-xl font-bold text-white mb-1">Top Performer</h3>
            <p className="text-sm text-slate-400">You're in the top 10% of users this week!</p>
        </div>
      </div>
    </div>
  );
};

const SettingsScreen = ({ user, onLogout, onBack, token }: { user: UserType, onLogout: () => void, onBack: () => void, token: string }) => {
  const [notifications, setNotifications] = useState(() => {
    return localStorage.getItem('tf_notifications') === 'true';
  });
  const [sounds, setSounds] = useState(() => {
    const val = localStorage.getItem('tf_sounds');
    return val === null ? true : val === 'true';
  });

  const toggleNotifications = () => {
    // Browser notifications are disabled - using toast notifications instead
    setNotifications(!notifications);
  };

  useEffect(() => {
    localStorage.setItem('tf_notifications', notifications.toString());
  }, [notifications]);

  useEffect(() => {
    localStorage.setItem('tf_sounds', sounds.toString());
  }, [sounds]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="md:hidden p-2 -ml-2 text-slate-400 hover:text-white rounded-full hover:bg-slate-800">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-slate-400" /> Settings
        </h2>
      </div>

      <div className="bg-surface rounded-xl border border-slate-700 overflow-hidden">
        <div className="p-6 border-b border-slate-700 bg-slate-800/50 flex items-center gap-4">
           <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-2xl font-bold text-white">
              {user.username.substring(0,2).toUpperCase()}
           </div>
           <div>
             <h3 className="text-lg font-bold text-white">{user.username}</h3>
             <p className="text-sm text-slate-400">{user.email}</p>
           </div>
        </div>
        
        <div className="p-6 space-y-6">
           {/* Preferences */}
           <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Preferences</h4>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                   <div className="flex items-center gap-3">
                      <Bell className="w-5 h-5 text-slate-400" />
                      <span className="text-slate-200">Push Notifications</span>
                   </div>
                   <button 
                     onClick={toggleNotifications}
                     className={`w-12 h-6 rounded-full transition-colors relative ${notifications ? 'bg-primary' : 'bg-slate-700'}`}
                   >
                      <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${notifications ? 'translate-x-6' : ''}`} />
                   </button>
                </div>
                <div className="flex items-center justify-between">
                   <div className="flex items-center gap-3">
                      <Volume2 className="w-5 h-5 text-slate-400" />
                      <span className="text-slate-200">Sound Effects</span>
                   </div>
                   <button 
                     onClick={() => setSounds(!sounds)}
                     className={`w-12 h-6 rounded-full transition-colors relative ${sounds ? 'bg-primary' : 'bg-slate-700'}`}
                   >
                      <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${sounds ? 'translate-x-6' : ''}`} />
                   </button>
                </div>
                 <div className="flex items-center justify-between opacity-50 cursor-not-allowed">
                   <div className="flex items-center gap-3">
                      <Palette className="w-5 h-5 text-slate-400" />
                      <span className="text-slate-200">Dark Mode</span>
                   </div>
                   <div className="text-xs text-slate-500">Always On</div>
                </div>
              </div>
           </div>

           {/* Integrations */}
           <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Integrations</h4>
              <div className="space-y-4">
                 <GmailSettings token={token} />
                 <TelegramSettings token={token} />
                 <SlackSettings token={token} />
              </div>
           </div>

           {/* Security */}
           <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Account</h4>
              <div className="space-y-4">
                 <button className="w-full text-left flex items-center gap-3 text-slate-300 hover:text-white transition-colors">
                    <Shield className="w-5 h-5" /> Change Password
                 </button>
                 <button 
                   onClick={onLogout}
                   className="w-full text-left flex items-center gap-3 text-red-400 hover:text-red-300 transition-colors"
                 >
                    <LogOut className="w-5 h-5" /> Sign Out
                 </button>
              </div>
           </div>
        </div>
      </div>
      
      <div className="text-center text-xs text-slate-600 pt-8">
        TASKFLOW.AI v1.3.0 • Build 2024.11
      </div>
    </div>
  );
};

const CompletedTasksScreen = ({ 
  tasks, 
  onBack,
  onExport,
  onUncomplete,
}: { 
  tasks: Task[], 
  onBack: () => void,
  onExport: (format: 'csv' | 'md', tasks: Task[]) => void,
  onUncomplete: (id: string) => void,
}) => {
  const [filter, setFilter] = useState<WorkspaceType | 'all'>('all');
  const [copied, setCopied] = useState(false);

  const filteredTasks = tasks.filter(t => filter === 'all' || t.workspace === filter);

  const groupTasksByDate = (tasksToGroup: Task[]) => {
    const groups: { [key: string]: Task[] } = {
      Today: [], Yesterday: [], 'This Week': [], Older: [],
    };
  
    const now = new Date();
    // Use setHours to get the start of the day in the user's local timezone.
    // This is robust against timezone shifts.
    const todayStart = new Date(now).setHours(0, 0, 0, 0);
    const yesterdayStart = todayStart - 86400000; // 24 * 60 * 60 * 1000
    
    // Calculate start of the week (Sunday) in the local timezone
    const dayOfWeek = now.getDay(); // 0 for Sunday
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek).getTime();

    for (const task of tasksToGroup) {
      // Use fallback if task is done but completedAt is missing (e.g. legacy data)
      // We prioritize completedAt, then createdAt, then assume 0 (Older)
      const completedTime = task.completedAt || task.createdAt || 0;
      
      if (completedTime >= todayStart) {
        groups.Today.push(task);
      } else if (completedTime >= yesterdayStart) {
        groups.Yesterday.push(task);
      } else if (completedTime >= startOfWeek) {
        groups['This Week'].push(task);
      } else {
        groups.Older.push(task);
      }
    }
    
    return groups;
  };

  const groupedTasks = groupTasksByDate(filteredTasks.sort((a, b) => {
    // Sort logic needs to handle potential undefineds for robustness
    const timeA = a.completedAt || a.createdAt || 0;
    const timeB = b.completedAt || b.createdAt || 0;
    return timeB - timeA;
  }));

  const handleCopy = () => {
    onExport('md', filteredTasks);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="md:hidden p-2 -ml-2 text-slate-400 hover:text-white rounded-full hover:bg-slate-800">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <CheckSquare className="w-6 h-6 text-emerald-400" /> Completed Tasks
        </h2>
      </div>

      {/* Filters and Exports */}
      <div className="bg-surface p-4 rounded-xl border border-slate-700 flex flex-col md:flex-row gap-4 justify-between items-center">
        <div className="flex items-center bg-slate-800/50 rounded-lg p-1 border border-slate-700/50">
          {(['all', 'job', 'freelance', 'personal'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all capitalize ${filter === f ? 'bg-slate-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
           <button 
             onClick={() => onExport('csv', filteredTasks)}
             className="py-2 px-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm flex items-center justify-center gap-2 transition-colors"
           >
             <Download className="w-4 h-4" /> CSV
           </button>
           <button 
             onClick={handleCopy}
             className="py-2 px-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm flex items-center justify-center gap-2 transition-colors"
           >
             {copied ? <Check className="w-4 h-4 text-green-400" /> : <Clipboard className="w-4 h-4" />}
             {copied ? 'Copied' : 'Markdown'}
           </button>
        </div>
      </div>
      
      {/* Task List */}
      <div className="space-y-6">
        {Object.entries(groupedTasks).map(([groupName, tasksInGroup]) => {
          if (tasksInGroup.length === 0) return null;
          return (
            <div key={groupName}>
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">{groupName}</h3>
              <div className="space-y-2">
                {tasksInGroup.map(task => (
                  <div key={task.id} className="bg-surface p-3 rounded-lg border border-slate-800 flex justify-between items-center group">
                    <div>
                      <p className="text-slate-300 line-through opacity-70">{task.title}</p>
                      <p className="text-xs text-slate-500 capitalize">{task.workspace}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">
                        {task.completedAt 
                          ? new Date(task.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                          : 'Unknown Date'
                        }
                      </span>
                      <button
                        onClick={() => onUncomplete(task.id)}
                        className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700 transition-colors opacity-0 group-hover:opacity-100"
                        title="Mark as To-Do"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {filteredTasks.length === 0 && (
          <div className="text-center py-20 text-slate-600">
            <CheckSquare className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p>No completed tasks found for this filter.</p>
          </div>
        )}
      </div>
    </div>
  );
};


// --- Main App ---

export default function App() {
  // Auth State
  const [user, setUser] = useState<UserType | null>(null);
  const [token, setToken] = useState<string | null>(null);

  // App State
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceType>('job');
  const [stats, setStats] = useState<UserStats>({ xp: 0, level: 1, streak: 0, completedToday: 0 });
  const [view, setView] = useState<AppView>(AppView.DASHBOARD);
  const [focusedTask, setFocusedTask] = useState<Task | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [motivation, setMotivation] = useState<string>('');
  const [xpFloat, setXpFloat] = useState<{ id: number, val: number }[]>([]);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [notifications, setNotifications] = useState<{id: string, message: string}[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [draftTasksCount, setDraftTasksCount] = useState<number>(0);
  const previousDraftCountRef = useRef<number>(0);
  const previousTasksCountRef = useRef<number>(0);
  
  // Power User Features
  const [searchQuery, setSearchQuery] = useState('');
  const [energyFilter, setEnergyFilter] = useState<'all' | 'focus' | 'chill'>('all');
  const [sortBy, setSortBy] = useState<'energy' | 'dueDate' | 'newest'>('energy');

  // Modal States
  const [linkingTask, setLinkingTask] = useState<Task | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; taskId: string | null; taskTitle: string }>({ isOpen: false, taskId: null, taskTitle: '' });
  const [alertModal, setAlertModal] = useState<{ isOpen: boolean; title: string; message: string; type: 'success' | 'error' | 'info' | 'warning' }>({ isOpen: false, title: '', message: '', type: 'info' });

  // Snooze background checker
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      let changed = false;
      const updatedTasks = tasks.map(t => {
        if (t.snoozedUntil && t.snoozedUntil < now) {
          changed = true;
          // Trigger toast notification for unsnoozed task
          addToast(`Task Ready! "${t.title}"`, 'info');
          const { snoozedUntil, ...rest } = t;
          return rest;
        }
        return t;
      });

      if (changed) {
        setTasks(updatedTasks);
        // Note: This local change isn't synced back to the server immediately
        // to avoid constant API calls. It will sync next time the task is updated.
        // A more robust solution would be a debounced batch update.
      }
    }, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, [tasks]);

  // Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K for Quick Add
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowQuickAdd(true);
      }
      // Esc to close modals
      if (e.key === 'Escape') {
        setShowQuickAdd(false);
        setLinkingTask(null);
        setFocusedTask(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Initialize
  useEffect(() => {
    const savedToken = localStorage.getItem('taskflow_token');
    const savedUser = localStorage.getItem('taskflow_user');
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
    }
  }, []);

  // Fetch draft tasks count
  const fetchDraftTasksCount = async () => {
    if (!token) return;
    try {
      const drafts = await api.draftTasks.getAll(token, 'pending');
      const newCount = drafts.length;
      
      // Play sound if new drafts arrived
      if (newCount > previousDraftCountRef.current && previousDraftCountRef.current > 0) {
        const newDraftsCount = newCount - previousDraftCountRef.current;
        playSound('complete'); // Use existing sound
        // Show toast notification
        addToast(`📧 ${newDraftsCount} new draft task${newDraftsCount > 1 ? 's' : ''} arrived!`, 'success');
      }
      
      setDraftTasksCount(newCount);
      previousDraftCountRef.current = newCount;
    } catch (error) {
      console.error('Failed to fetch draft tasks count:', error);
    }
  };

  // Poll for draft tasks count (every 30 seconds)
  useEffect(() => {
    if (!token) return;
    
    // Fetch immediately (but don't play sound on initial load)
    fetchDraftTasksCount();
    
    // Then poll every 30 seconds
    const interval = setInterval(() => {
      fetchDraftTasksCount();
    }, 30000);
    
    return () => clearInterval(interval);
  }, [token]);

  // Graceful polling for tasks when on dashboard (every 30 seconds)
  useEffect(() => {
    if (!token || view !== AppView.DASHBOARD) return;
    
    const pollTasks = async () => {
      try {
        let fetchedTasks = await api.getTasks(token);
        
        // Sanitize incoming data
        const sanitizeTimestamp = (ts: any): number | undefined => {
          if (ts === null || ts === undefined || ts === '') return undefined;
          let num = Number(ts);
          if (isNaN(num)) return undefined;
          if (num > 0 && num < 100000000000) {
            num *= 1000;
          }
          return num;
        };

        fetchedTasks = fetchedTasks.map(task => {
          const sanitizedCompletedAt = sanitizeTimestamp(task.completedAt);
          const sanitizedCreatedAt = sanitizeTimestamp(task.createdAt) || Date.now();
          let finalCompletedAt = sanitizedCompletedAt;
          if (task.status === 'done' && !finalCompletedAt) {
            finalCompletedAt = 0;
          }

          return {
            ...task,
            id: String(task.id),
            createdAt: sanitizedCreatedAt,
            completedAt: finalCompletedAt,
            dueDate: sanitizeTimestamp(task.dueDate),
            estimatedTime: task.estimatedTime ? Number(task.estimatedTime) : undefined,
            snoozedUntil: sanitizeTimestamp(task.snoozedUntil),
          };
        });

        // Update tasks gracefully - merge new tasks and update existing ones
        setTasks(prevTasks => {
          const taskMap = new Map(prevTasks.map(t => [t.id, t]));
          const newTasks: Task[] = [];
          let hasNewTasks = false;

          fetchedTasks.forEach(fetchedTask => {
            const existingTask = taskMap.get(fetchedTask.id);
            if (existingTask) {
              // Update existing task if it changed
              if (JSON.stringify(existingTask) !== JSON.stringify(fetchedTask)) {
                taskMap.set(fetchedTask.id, fetchedTask);
              }
            } else {
              // New task
              newTasks.push(fetchedTask);
              hasNewTasks = true;
            }
          });

          // Remove tasks that no longer exist
          const fetchedTaskIds = new Set(fetchedTasks.map(t => t.id));
          const removedTasks = prevTasks.filter(t => !fetchedTaskIds.has(t.id));

          // Notify about new tasks
          if (hasNewTasks && newTasks.length > 0 && previousTasksCountRef.current > 0) {
            playSound('complete');
            addToast(`✨ ${newTasks.length} new task${newTasks.length > 1 ? 's' : ''} added!`, 'success');
          }

          // Update count
          previousTasksCountRef.current = fetchedTasks.length;

          // Return merged array
          return Array.from(taskMap.values()).concat(newTasks);
        });

        // Update stats
        const lastResetTime = user?.last_reset_at 
          ? new Date(String(user.last_reset_at).replace(' ', 'T')).getTime() 
          : 0;
        const todayString = new Date().toDateString();
        const completedToday = fetchedTasks.filter(t => {
          if (t.status !== 'done' || !t.completedAt) return false;
          if (lastResetTime > 0 && !isNaN(lastResetTime)) {
            return t.completedAt > lastResetTime;
          } else {
            return new Date(t.completedAt).toDateString() === todayString;
          }
        }).length;

        setStats(prev => ({
          ...prev,
          completedToday
        }));
      } catch (error) {
        console.error('Failed to poll tasks:', error);
      }
    };

    // Poll immediately, then every 30 seconds
    pollTasks();
    const interval = setInterval(pollTasks, 30000);
    
    return () => clearInterval(interval);
  }, [token, view, user]);

  // Fetch Data on Auth
  useEffect(() => {
    if (token && user) {
      fetchData();
    }
  }, [token, user]);

  const fetchData = async () => {
    if (!token) return;
    try {
      let fetchedTasks = await api.getTasks(token);
      
      // *** START OF FIX: Sanitize incoming data to ensure correct types ***
      const sanitizeTimestamp = (ts: any): number | undefined => {
        if (ts === null || ts === undefined || ts === '') return undefined;
        let num = Number(ts);
        if (isNaN(num)) return undefined;
        // Check if timestamp is likely in seconds (e.g., a 10-digit number) and convert to milliseconds
        // This is a common issue when integrating with PHP backends (time() vs. microtime(true))
        if (num > 0 && num < 100000000000) {
          num *= 1000;
        }
        return num;
      };

      fetchedTasks = fetchedTasks.map(task => {
        const sanitizedCompletedAt = sanitizeTimestamp(task.completedAt);
        const sanitizedCreatedAt = sanitizeTimestamp(task.createdAt) || Date.now();
        
        // Ensure done tasks have a timestamp so they appear in lists
        // If completedAt is missing for a done task, fallback to 0 (older) instead of Date.now()
        let finalCompletedAt = sanitizedCompletedAt;
        if (task.status === 'done' && !finalCompletedAt) {
           finalCompletedAt = 0; // Default to 0 instead of Date.now() to avoid cluttering "Today"
        }

        return {
          ...task,
          id: String(task.id), // Ensure ID is string to prevent React key issues
          createdAt: sanitizedCreatedAt, 
          completedAt: finalCompletedAt,
          dueDate: sanitizeTimestamp(task.dueDate),
          estimatedTime: task.estimatedTime ? Number(task.estimatedTime) : undefined,
          snoozedUntil: sanitizeTimestamp(task.snoozedUntil),
        };
      });
      // *** END OF FIX ***

      setTasks(fetchedTasks);
      
      // Refresh draft tasks count after fetching tasks (in case new drafts were created)
      if (token) {
        fetchDraftTasksCount();
      }
      
      // Calculate daily stats from tasks
      // UPDATED LOGIC: Respect "last_reset_at" if it exists, handle date parsing safely
      const lastResetTime = user?.last_reset_at 
        ? new Date(String(user.last_reset_at).replace(' ', 'T')).getTime() 
        : 0;
        
      const todayString = new Date().toDateString();

      const completedToday = fetchedTasks.filter(t => {
         if (t.status !== 'done' || !t.completedAt) return false;
         
         if (lastResetTime > 0 && !isNaN(lastResetTime)) {
           // If user has reset, count only tasks completed AFTER the reset
           return t.completedAt > lastResetTime;
         } else {
           // Fallback to calendar day if no reset data
           return new Date(t.completedAt).toDateString() === todayString;
         }
      }).length;

      // Stats are primarily from user login, but we update locally for immediate feedback
      setStats(prev => ({
        ...prev,
        completedToday
      }));
      
    } catch (error) {
      console.error("Failed to fetch data", error);
      if ((error as any).message === 'Unauthorized') {
         handleLogout();
      }
    }
  };

  const handleLogin = (user: UserType, token: string, initialStats: UserStats) => {
    setUser(user);
    setToken(token);
    setStats(initialStats);
    localStorage.setItem('taskflow_token', token);
    localStorage.setItem('taskflow_user', JSON.stringify(user));
  };

  const handleLogout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('taskflow_token');
    localStorage.removeItem('taskflow_user');
    setView(AppView.DASHBOARD);
  };

  // Derived State
  const pendingTasksAll = tasks.filter(t => t.status !== 'done');
  const completedTasksAll = tasks.filter(t => t.status === 'done');
  
  const now = Date.now();
  const activeTasks = tasks.filter(t => t.workspace === activeWorkspace && t.status !== 'done' && (!t.snoozedUntil || t.snoozedUntil < now));
  
  const waitingTasks = activeTasks.filter(t => t.status === 'waiting');
  let currentTasks = activeTasks.filter(t => t.status !== 'waiting');

  // Search Filter
  if (searchQuery) {
    currentTasks = currentTasks.filter(t => t.title.toLowerCase().includes(searchQuery.toLowerCase()));
  }

  // Energy Mode Filter
  if (energyFilter === 'focus') {
    currentTasks = currentTasks.filter(t => t.energy === 'high' || t.energy === 'medium');
  } else if (energyFilter === 'chill') {
    currentTasks = currentTasks.filter(t => t.energy === 'low' || t.energy === 'medium');
  }

  // Tag Filter
  if (tagFilter) {
    currentTasks = currentTasks.filter(t => t.tags.includes(tagFilter));
  }
  
  // Get all unique tags for the filter bar
  const availableTags = Array.from(new Set(
    tasks.filter(t => t.workspace === activeWorkspace && t.status !== 'done' && (!t.snoozedUntil || t.snoozedUntil < now))
         .flatMap(t => t.tags)
  ));

  // Handlers
  const addNotification = (message: string) => {
    const id = crypto.randomUUID();
    setNotifications(prev => [...prev, { id, message }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 4000);
  };

  const addToast = (message: string, type: ToastType = 'info', duration?: number) => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, message, type, duration }]);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const addTask = async (title: string, description?: string) => {
    if (!token) return;

    const combinedInput = description 
      ? `${title}\n\n${description}`
      : title;

    let newTask: Task = {
      id: crypto.randomUUID(),
      title,
      description: description || undefined,
      workspace: activeWorkspace,
      energy: 'medium',
      status: 'todo',
      tags: [],
      dependencies: [],
      createdAt: Date.now(),
      estimatedTime: 15,
    };

    const aiResult = await parseTaskWithGemini(combinedInput, token);
    
    if (aiResult) {
      newTask = {
        ...newTask,
        // Keep the user's title/description, only enrich metadata
        title,
        energy: aiResult.energy,
        estimatedTime: aiResult.estimatedTime,
        tags: aiResult.tags,
        // Respect the current tab for Personal/Freelance; allow AI to shift only from default Work
        workspace: activeWorkspace === 'job' && aiResult.workspaceSuggestions
          ? aiResult.workspaceSuggestions
          : activeWorkspace,
      };
    }

    // Optimistic Update
    setTasks(prev => [newTask, ...prev]);

    // Sync to Backend
    try {
      await api.syncTask(token, newTask);
      // Refresh draft count in case this was from a draft
      fetchDraftTasksCount();
    } catch (e) {
      console.error("Failed to sync task", e);
      // Revert if failed
      setTasks(prev => prev.filter(t => t.id !== newTask.id));
    }
  };

  const updateTask = async (updatedTask: Task) => {
    if (!token) return;
    
    // Optimistic
    setTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));

    // Sync
    try {
      await api.syncTask(token, updatedTask);
    } catch (e) {
      console.error("Failed to update task", e);
      fetchData(); // Revert by fetching
    }
  };

  const deleteTask = async (id: string) => {
    if (!token) return;
    
    const task = tasks.find(t => t.id === id);
    if (task) {
      setDeleteConfirm({ isOpen: true, taskId: id, taskTitle: task.title });
    }
  };

  const confirmDeleteTask = async () => {
    if (!token || !deleteConfirm.taskId) return;
    
    const taskId = deleteConfirm.taskId;
    setDeleteConfirm({ isOpen: false, taskId: null, taskTitle: '' });
    
    setTasks(prev => prev.filter(t => t.id !== taskId));
    try {
      await api.deleteTask(token, taskId);
      addToast('Task deleted successfully', 'success');
    } catch (e) {
      console.error("Failed to delete", e);
      fetchData();
      setAlertModal({ isOpen: true, title: 'Error', message: 'Failed to delete task. Please try again.', type: 'error' });
    }
  };

  const completeTask = async (id: string) => {
    if (!token) return;

    const completedTask = tasks.find(t => t.id === id);
    if (!completedTask) return;

    // 1. Dependency Notification Check
    const blockedTasks = tasks.filter(t => t.dependencies?.includes(id));
    blockedTasks.forEach(blockedTask => {
        const remainingBlockers = (blockedTask.dependencies || []).filter(depId => {
            if (depId === id) return false; 
            const depTask = tasks.find(t => t.id === depId);
            return depTask && depTask.status !== 'done';
        });
        if (remainingBlockers.length === 0) {
            addToast(`🔓 Ready to start: ${blockedTask.title}`, 'success');
        }
    });

    // 2. Handle Recurrence
    let nextTask: Task | null = null;
    if (completedTask.recurrence) {
        const { frequency, interval } = completedTask.recurrence;
        const currentDueDate = completedTask.dueDate ? new Date(completedTask.dueDate) : new Date();
        const nextDueDate = new Date(currentDueDate);

        if (frequency === 'daily') nextDueDate.setDate(currentDueDate.getDate() + interval);
        else if (frequency === 'weekly') nextDueDate.setDate(currentDueDate.getDate() + 7 * interval);
        else if (frequency === 'monthly') nextDueDate.setMonth(currentDueDate.getMonth() + interval);

        nextTask = {
            ...completedTask,
            id: crypto.randomUUID(),
            status: 'todo',
            createdAt: Date.now(),
            dueDate: nextDueDate.getTime(),
            completedAt: undefined,
            originalRecurrenceId: completedTask.originalRecurrenceId || completedTask.id,
            dependencies: [],
        };
    }

    // 3. Optimistic UI Update
    setTasks(prev => {
        const updated = prev.map(t => t.id === id ? { ...t, status: 'done', completedAt: Date.now() } : t);
        return nextTask ? [nextTask, ...updated] : updated;
    });
    
    // 4. Sound Effect
    playSound('complete');
    
    // 5. API Call
    try {
       if (nextTask) {
           // Sync the new recurring task
           api.syncTask(token, nextTask);
       }
       // Mark original as complete
       const res = await api.completeTask(token, id);
       
       if (res.success) {
         // Show XP Float
         const popId = Date.now();
         setXpFloat(prev => [...prev, { id: popId, val: 50 }]);
         setTimeout(() => setXpFloat(prev => prev.filter(p => p.id !== popId)), 1000);

         // Update Stats
         if (res.leveled_up) {
           setShowLevelUp(true);
           playSound('levelUp');
         }
         
         setStats(prev => ({
           ...prev,
           xp: res.new_xp,
           level: res.new_level || prev.level,
           completedToday: prev.completedToday + 1
         }));
       }
    } catch (e) {
      console.error("Complete failed", e);
      fetchData();
    }
  };
  
  const uncompleteTask = async (id: string) => {
    if (!token) return;

    const taskToUncomplete = tasks.find(t => t.id === id);
    if (!taskToUncomplete) return;

    // Create the updated task object
    const updatedTask: Task = { 
      ...taskToUncomplete, 
      status: 'todo', 
      completedAt: undefined 
    };

    // Optimistic update
    setTasks(prev => prev.map(t => t.id === id ? updatedTask : t));

    // Update stats locally
    const today = new Date().toDateString();
    if (taskToUncomplete.completedAt && new Date(taskToUncomplete.completedAt).toDateString() === today) {
        setStats(prev => ({
            ...prev,
            completedToday: Math.max(0, prev.completedToday - 1),
        }));
    }

    try {
        // Use syncTask to persist the change to the backend
        await api.syncTask(token, updatedTask);
    } catch (e) {
        console.error("Uncomplete task failed", e);
        fetchData(); // Revert on failure
    }
  };


  const startFocus = (task: Task) => {
    setFocusedTask(task);
    setView(AppView.FOCUS_MODE);
  };

  const endFocus = (completed: boolean) => {
    if (completed && focusedTask) {
      completeTask(focusedTask.id);
    }
    setFocusedTask(null);
    setView(AppView.DASHBOARD);
  };

  const handleDailyReset = async () => {
    setView(AppView.DAILY_RESET);
  };

  const finishDailyReset = async () => {
    if (!token) {
        setView(AppView.DASHBOARD);
        return;
    }

    try {
      // 1) Roll over pending tasks to tomorrow (for overdue or undated tasks)
      const nowDate = new Date();
      const tomorrow = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() + 1);
      const tomorrowTs = tomorrow.getTime();

      const updatedTasks: Task[] = [];
      const nextTasksState = tasks.map((t) => {
        if (t.status !== 'done' && (!t.dueDate || t.dueDate <= nowDate.getTime())) {
          const updated: Task = { ...t, dueDate: tomorrowTs };
          updatedTasks.push(updated);
          return updated;
        }
        return t;
      });

      if (updatedTasks.length > 0) {
        setTasks(nextTasksState);
        // Fire-and-forget sync of updated tasks
        for (const task of updatedTasks) {
          try {
            await api.syncTask(token, task);
          } catch (err) {
            console.error('Failed to roll over task', task.id, err);
          }
        }
      }

      // 2) Send Slack summary of today's completed Job tasks
      const todayLabel = nowDate.toLocaleDateString();
      const todayStr = nowDate.toDateString();
      const completedTodayJob = completedTasksAll.filter(
        (t) =>
          t.workspace === 'job' &&
          t.completedAt &&
          new Date(t.completedAt).toDateString() === todayStr
      );

      if (completedTodayJob.length > 0) {
        try {
          await api.slack.dailySummary(token, completedTodayJob, todayLabel);
        } catch (err) {
          console.error('Failed to post Slack daily summary', err);
        }
      }

      // 3) Tell backend we've reset the day
      const res = await api.dailyReset(token);
      
      // Strict check: Only reset if the server confirms success and returns a timestamp
      if (res.success && res.reset_time && user) {
          // Update user's last_reset_at locally so fetchData works correctly immediately
          const updatedUser = { ...user, last_reset_at: res.reset_time };
          setUser(updatedUser);
          localStorage.setItem('taskflow_user', JSON.stringify(updatedUser));

          // Reset tasks logic
          // We update stats locally to 0
          setStats(prev => ({ 
            ...prev, 
            completedToday: 0,
            streak: prev.completedToday > 0 ? prev.streak + 1 : prev.streak
          }));
          setView(AppView.DASHBOARD);
      } else {
          console.error("Daily reset failed: Server did not return a valid timestamp.", res);
          setAlertModal({ isOpen: true, title: 'Error', message: "Failed to save Daily Reset. Please ensure your database is updated with the 'last_reset_at' column.", type: 'error' });
      }
    } catch (e) {
      console.error("Reset sync failed", e);
      setAlertModal({ isOpen: true, title: 'Connection Error', message: "Connection failed during Daily Reset. Please try again.", type: 'error' });
    }
  };

  // Dependency Handlers
  const addDependency = (taskId: string, dependencyId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    const currentDeps = task.dependencies || [];
    if (!currentDeps.includes(dependencyId)) {
      const updated = { ...task, dependencies: [...currentDeps, dependencyId] };
      updateTask(updated);
    }
    setLinkingTask(null);
  };

  const removeDependency = (taskId: string, dependencyId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const updated = { 
      ...task, 
      dependencies: (task.dependencies || []).filter(id => id !== dependencyId) 
    };
    updateTask(updated);
  };
  
  // Snooze & Waiting Handlers
  const snoozeTask = (id: string, duration: 'hour' | 'day' | 'week') => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    
    let snoozedUntil = Date.now();
    if (duration === 'hour') snoozedUntil += 3600 * 1000;
    if (duration === 'day') snoozedUntil += 24 * 3600 * 1000;
    if (duration === 'week') snoozedUntil += 7 * 24 * 3600 * 1000;

    updateTask({ ...task, snoozedUntil });
  };

  const setWaitingStatus = (id: string) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    const newStatus = task.status === 'waiting' ? 'todo' : 'waiting';
    updateTask({ ...task, status: newStatus });
  };

  const handleExport = (format: 'csv' | 'md', tasksToExport: Task[]) => {
    if (format === 'csv') {
      // CSV Export: Strictly restricted to Title and Completed At
      const headers = "Title,Completed At\n";
      const rows = tasksToExport.map(task => {
        const title = `"${task.title.replace(/"/g, '""')}"`;
        // NO Tags, NO Workspace, NO Time
        const completed = task.completedAt ? new Date(task.completedAt).toLocaleString() : 'N/A';
        return [title, completed].join(',');
      }).join('\n');

      const csvContent = headers + rows;
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        const today = new Date().toISOString().split('T')[0];
        link.setAttribute("href", url);
        link.setAttribute("download", `taskflow_report_${today}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } else if (format === 'md') {
      // Markdown Export: Strictly restricted to Title
      const markdown = tasksToExport.map(task => 
        `- [x] ${task.title}`
      ).join('\n');
      navigator.clipboard.writeText(markdown);
    }
  };


  useEffect(() => {
    if (user) {
      if (token) {
        getDailyMotivation(stats.completedToday, pendingTasksAll.length, token).then(setMotivation);
      }
    }
  }, [user, stats.completedToday]);

  // If not logged in, show Auth
  if (!user) {
    return <AuthScreen onLogin={handleLogin} />;
  }

  // Render Logic
  if (view === AppView.FOCUS_MODE && focusedTask) {
    return <FocusOverlay task={focusedTask} onExit={() => endFocus(false)} onComplete={() => endFocus(true)} />;
  }

  if (view === AppView.DAILY_RESET) {
    const today = new Date().toDateString();
    const completedToday = completedTasksAll.filter(t => t.completedAt && new Date(t.completedAt).toDateString() === today);
    return <DailyReset completedTasks={completedToday} pendingTasks={pendingTasksAll} token={token!} onClose={finishDailyReset} onExport={handleExport} />;
  }

  return (
    <div className="min-h-screen bg-background text-slate-200 pb-24 md:pb-0 relative">
      
      {/* Toast Notifications */}
      <div className="fixed top-20 right-4 z-[60] flex flex-col gap-2 w-full max-w-sm pointer-events-none">
        {notifications.map(n => (
          <div key={n.id} className="bg-emerald-900/90 border border-emerald-500/50 p-4 rounded-lg shadow-xl text-emerald-100 flex items-center gap-3 animate-in slide-in-from-right duration-300 pointer-events-auto">
             <div className="p-2 bg-emerald-800 rounded-full">
               <Unlock className="w-4 h-4 text-emerald-300" />
             </div>
             <div>
               <p className="font-bold text-sm">Task Unlocked!</p>
               <p className="text-xs opacity-90">{n.message.replace('🔓 Ready to start: ', '')}</p>
             </div>
          </div>
        ))}
      </div>

      {/* Level Up Modal */}
      {showLevelUp && (
        <LevelUpModal level={stats.level} onClose={() => setShowLevelUp(false)} />
      )}

      {/* Floating XP Poppers */}
      {xpFloat.map(pop => (
        <div key={pop.id} className="fixed bottom-10 right-10 pointer-events-none z-50 animate-bounce text-yellow-400 font-bold text-2xl shadow-black drop-shadow-md">
          +{pop.val} XP
        </div>
      ))}

      {/* Dependency Link Modal */}
      {linkingTask && (
        <DependencyModal 
          task={linkingTask}
          potentialDependencies={pendingTasksAll.filter(t => t.id !== linkingTask.id && !linkingTask.dependencies?.includes(t.id))}
          onSelect={(depId) => addDependency(linkingTask.id, depId)}
          onClose={() => setLinkingTask(null)}
        />
      )}

      {/* Task Detail Modal */}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onComplete={completeTask}
          onUpdate={updateTask}
        />
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmationModal
        isOpen={deleteConfirm.isOpen}
        title="Delete Task"
        message={`Are you sure you want to delete "${deleteConfirm.taskTitle}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        onConfirm={confirmDeleteTask}
        onCancel={() => setDeleteConfirm({ isOpen: false, taskId: null, taskTitle: '' })}
      />

      {/* Alert Modal */}
      <AlertModal
        isOpen={alertModal.isOpen}
        title={alertModal.title}
        message={alertModal.message}
        type={alertModal.type}
        onClose={() => setAlertModal({ isOpen: false, title: '', message: '', type: 'info' })}
      />

      {/* Mobile/Tablet Layout container */}
      <div className="max-w-4xl mx-auto min-h-screen flex flex-col md:flex-row">
        
        {/* Sidebar (Desktop) / Topbar (Mobile) */}
        <div className="md:w-64 p-4 md:p-6 md:h-screen md:sticky md:top-0 flex flex-col md:border-r border-slate-800 bg-background/95 backdrop-blur z-20">
          <div className="flex items-center gap-3 mb-8 cursor-pointer group" onClick={() => setView(AppView.DASHBOARD)}>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center shadow-lg shadow-primary/20 group-hover:scale-110 transition-transform">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight text-white group-hover:text-primary transition-colors">TASKFLOW</h1>
              <div className="text-xs text-slate-500 font-mono flex items-center gap-1">
                 <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                 Lvl {stats.level} Dev
              </div>
            </div>
          </div>

          <div className="space-y-6 flex-1">
            {/* XP Card */}
            <div className="p-4 rounded-xl bg-surface border border-slate-700/50">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-semibold text-slate-400">DAILY GOAL</span>
                <span className="text-xs font-mono text-primary">{stats.completedToday}/5</span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-primary to-cyan-400 transition-all duration-500"
                  style={{ width: `${Math.min((stats.completedToday / 5) * 100, 100)}%` }}
                />
              </div>
              <div className="flex justify-between mt-3 text-xs text-slate-500">
                <div className="flex items-center gap-1"><Trophy className="w-3 h-3 text-yellow-500" /> {stats.xp} XP</div>
                <div className="flex items-center gap-1"><Flame className="w-3 h-3 text-orange-500" /> {stats.streak} Days</div>
              </div>
            </div>

            {/* Navigation */}
            <nav className="space-y-1 hidden md:block">
               <button 
                  onClick={() => setView(AppView.DASHBOARD)}
                  className={`w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${view === AppView.DASHBOARD ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}
                >
                  <Layout className="w-4 h-4" /> Dashboard
                </button>
                 <button 
                  onClick={() => setView(AppView.COMPLETED_TASKS)}
                  className={`w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${view === AppView.COMPLETED_TASKS ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}
                >
                  <CheckSquare className="w-4 h-4" /> Completed
                </button>
                <button 
                  onClick={() => setView(AppView.ANALYTICS)}
                  className={`w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${view === AppView.ANALYTICS ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}
                >
                  <BarChart2 className="w-4 h-4" /> Analytics
                </button>
                <button 
                  onClick={() => setView(AppView.DRAFT_TASKS)}
                  className={`w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors flex items-center justify-between gap-3 ${view === AppView.DRAFT_TASKS ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}
                >
                  <div className="flex items-center gap-3">
                    <Mail className="w-4 h-4" /> Draft Tasks
                  </div>
                  {draftTasksCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-accent text-white text-xs font-bold min-w-[20px] text-center">
                      {draftTasksCount > 99 ? '99+' : draftTasksCount}
                    </span>
                  )}
                </button>
                <button 
                  onClick={() => setView(AppView.SETTINGS)}
                  className={`w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${view === AppView.SETTINGS ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}
                >
                  <SettingsIcon className="w-4 h-4" /> Settings
                </button>
            </nav>
          </div>
          
          {/* Motivation Footer */}
          <div className="hidden md:block mt-auto pt-6 border-t border-slate-800 space-y-4">
            <button 
              onClick={handleDailyReset}
              className="w-full py-2 px-3 rounded-lg border border-slate-700 bg-slate-800/50 hover:bg-slate-800 hover:text-white text-slate-400 text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <RotateCcw className="w-4 h-4" /> End Day Reset
            </button>
            <button 
              onClick={handleLogout}
              className="w-full py-2 px-3 rounded-lg border border-transparent hover:bg-red-900/20 text-slate-500 hover:text-red-400 text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <LogOut className="w-4 h-4" /> Sign Out
            </button>
            <p className="text-xs text-slate-500 italic">"{motivation}"</p>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 p-4 md:p-8 overflow-y-auto">
          
          {/* Dashboard View */}
          {view === AppView.DASHBOARD && (
            <>
              {/* Header & Tabs */}
              <header className="mb-6 space-y-4">
                <div className="flex justify-between items-start">
                  <div className="flex overflow-x-auto pb-2 md:pb-0 gap-2 scrollbar-hide">
                    <WorkspaceTab 
                      active={activeWorkspace === 'job'} 
                      type="job" 
                      onClick={() => setActiveWorkspace('job')} 
                      icon={<Briefcase className="w-4 h-4" />} 
                    />
                    <WorkspaceTab 
                      active={activeWorkspace === 'freelance'} 
                      type="freelance" 
                      onClick={() => setActiveWorkspace('freelance')} 
                      icon={<Laptop className="w-4 h-4" />} 
                    />
                    <WorkspaceTab 
                      active={activeWorkspace === 'personal'} 
                      type="personal" 
                      onClick={() => setActiveWorkspace('personal')} 
                      icon={<User className="w-4 h-4" />} 
                    />
                  </div>
                  <div className="md:hidden flex gap-3">
                     <button onClick={() => setView(AppView.COMPLETED_TASKS)} className="text-slate-400">
                        <CheckSquare className="w-5 h-5" />
                     </button>
                     <button onClick={() => setView(AppView.ANALYTICS)} className="text-slate-400">
                        <BarChart2 className="w-5 h-5" />
                     </button>
                     <button onClick={() => setView(AppView.SETTINGS)} className="text-slate-400">
                        <SettingsIcon className="w-5 h-5" />
                     </button>
                  </div>
                </div>

                {/* Toolbar: Search & Energy Toggle */}
                <div className="flex flex-col md:flex-row gap-4 justify-between items-end md:items-center">
                  <div className="w-full md:w-auto flex-1 max-w-sm relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input 
                      type="text" 
                      placeholder="Search tasks..." 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-slate-800/50 border border-slate-700 rounded-full py-2 pl-9 pr-4 text-sm text-slate-300 focus:outline-none focus:border-slate-500 transition-colors"
                    />
                  </div>
                  
                  <div className="flex w-full md:w-auto items-center justify-between gap-2">
                    <div className="flex items-center bg-slate-800/50 rounded-lg p-1 border border-slate-700/50">
                      <button
                        onClick={() => setEnergyFilter('all')}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${energyFilter === 'all' ? 'bg-slate-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                      >
                        All
                      </button>
                      <button
                        onClick={() => setEnergyFilter('focus')}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${energyFilter === 'focus' ? 'bg-accent text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                      >
                        <Zap className="w-3 h-3" /> Focus
                      </button>
                      <button
                        onClick={() => setEnergyFilter('chill')}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${energyFilter === 'chill' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                      >
                        <Coffee className="w-3 h-3" /> Chill
                      </button>
                    </div>

                     <div className="relative flex items-center gap-2">
                        <select
                          value={sortBy}
                          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                          className="appearance-none bg-slate-800/50 border border-slate-700/50 rounded-lg py-2 pl-3 pr-8 text-xs font-medium text-slate-400 hover:text-slate-200 focus:outline-none focus:border-slate-500"
                        >
                          <option value="energy">By Energy</option>
                          <option value="dueDate">By Due Date</option>
                          <option value="newest">By Newest</option>
                        </select>
                        <ArrowUpDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
                        
                        {/* Manual integration fetch button */}
                        {token && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await Promise.all([
                                  api.gmail.scanNow(token, 50).catch((e) => console.error('Gmail scan error', e)),
                                  api.slack.scanNow(token, 50).catch((e) => console.error('Slack scan error', e)),
                                ]);
                                addToast('🔄 Fetched tasks from integrations (Gmail & Slack)', 'info');
                                // Refresh drafts count after manual sync
                                fetchDraftTasksCount();
                              } catch (err) {
                                console.error('Manual integration fetch failed', err);
                                addToast('Failed to fetch from integrations', 'error');
                              }
                            }}
                            className="hidden md:inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200 hover:bg-slate-700"
                          >
                            <RefreshCw className="w-3 h-3" /> Fetch Integrations
                          </button>
                        )}
                      </div>
                  </div>
                  
                  <button 
                    onClick={() => setShowQuickAdd(true)}
                    className="md:hidden p-3 bg-primary rounded-full text-white shadow-lg shadow-primary/30 active:scale-95 transition-transform"
                  >
                    <Plus className="w-6 h-6" />
                  </button>
                </div>

                <div className="flex justify-between items-end">
                   <div>
                    <h2 className="text-2xl font-bold text-white mb-1">
                      {activeWorkspace === 'job' ? 'Work Tasks' : activeWorkspace === 'freelance' ? 'Client Projects' : 'Life Admin'}
                    </h2>
                    <p className="text-slate-400 text-sm">
                      {currentTasks.length + waitingTasks.length} visible • {energyFilter === 'all' ? 'All Energies' : energyFilter === 'focus' ? 'High/Med Energy' : 'Low/Med Energy'}
                    </p>
                  </div>
                </div>
                
                {/* Tag Filters */}
                {availableTags.length > 0 && (
                   <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 scrollbar-hide">
                      <button
                         onClick={() => setTagFilter(null)}
                         className={`px-3 py-1 rounded-full text-xs font-medium border whitespace-nowrap transition-colors ${!tagFilter ? 'bg-white text-slate-900 border-white' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
                      >
                         All
                      </button>
                      {availableTags.map(tag => (
                        <button
                          key={tag}
                          onClick={() => setTagFilter(tag === tagFilter ? null : tag)}
                          className={`px-3 py-1 rounded-full text-xs font-medium border whitespace-nowrap transition-colors ${tag === tagFilter ? 'bg-primary text-white border-primary' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
                        >
                          #{tag}
                        </button>
                      ))}
                   </div>
                )}
              </header>

              {/* Task Lists */}
              <div className="space-y-8">
                 {/* Awaiting Section */}
                 {waitingTasks.length > 0 && (
                   <section className="animate-in slide-in-from-bottom-4 duration-500">
                     <div className="flex items-center gap-2 mb-3">
                       <Hourglass className="w-5 h-5 text-amber-400" />
                       <h3 className="font-semibold text-slate-300">Awaiting / Blocked</h3>
                     </div>
                     <div className="grid gap-3">
                       {waitingTasks.map(task => {
                         const blockers = tasks.filter(t => 
                           task.dependencies?.includes(t.id) && t.status !== 'done'
                         );
                         return (
                           <TaskCard 
                             key={task.id} 
                             task={task} 
                             blockingTasks={blockers}
                             token={token!}
                             onComplete={completeTask} 
                             onUpdate={updateTask}
                             onStartFocus={startFocus}
                             onAddDependency={() => setLinkingTask(task)}
                             onRemoveDependency={removeDependency}
                             onDelete={deleteTask}
                             onSnooze={snoozeTask}
                             onSetWaiting={setWaitingStatus}
                             onViewDetails={setSelectedTask}
                           />
                         );
                       })}
                     </div>
                   </section>
                 )}

                {/* Energy Sections */}
                {['high', 'medium', 'low'].map((energy) => {
                  // Only render if matches filter
                  if (energyFilter === 'focus' && energy === 'low') return null;
                  if (energyFilter === 'chill' && energy === 'high') return null;

                  const energyTasks = currentTasks.filter(t => t.energy === energy);
                  
                  const sortedEnergyTasks = [...energyTasks].sort((a, b) => {
                    if (sortBy === 'dueDate') {
                      if (!a.dueDate && !b.dueDate) return b.createdAt - a.createdAt;
                      if (!a.dueDate) return 1;
                      if (!b.dueDate) return -1;
                      return a.dueDate - b.dueDate;
                    }
                    if (sortBy === 'newest') {
                      return b.createdAt - a.createdAt;
                    }
                    // Default 'energy' sort is effectively newest first as a fallback
                    return b.createdAt - a.createdAt;
                  });

                  if (sortedEnergyTasks.length === 0) return null;

                  return (
                    <section key={energy} className="animate-in slide-in-from-bottom-4 duration-500">
                      <div className="flex items-center gap-2 mb-3">
                        {energy === 'high' && <Zap className="w-5 h-5 text-accent" />}
                        {energy === 'medium' && <Brain className="w-5 h-5 text-warning" />}
                        {energy === 'low' && <Coffee className="w-5 h-5 text-success" />}
                        <h3 className="font-semibold text-slate-300 capitalize">{energy} Energy</h3>
                      </div>
                      <div className="grid gap-3">
                        {sortedEnergyTasks.map(task => {
                          const blockers = tasks.filter(t => 
                            task.dependencies?.includes(t.id) && t.status !== 'done'
                          );

                          return (
                            <TaskCard 
                              key={task.id} 
                              task={task} 
                              blockingTasks={blockers}
                              token={token!}
                              onComplete={completeTask} 
                              onUpdate={updateTask}
                              onStartFocus={startFocus}
                              onAddDependency={() => setLinkingTask(task)}
                              onRemoveDependency={removeDependency}
                              onDelete={deleteTask}
                              onSnooze={snoozeTask}
                              onSetWaiting={setWaitingStatus}
                              onViewDetails={setSelectedTask}
                            />
                          );
                        })}
                      </div>
                    </section>
                  );
                })}

                {currentTasks.length === 0 && waitingTasks.length === 0 && (
                  <div className="text-center py-20 text-slate-600">
                    <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <p>No tasks found for this filter.</p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Analytics View */}
          {view === AppView.ANALYTICS && <AnalyticsScreen tasks={tasks} onBack={() => setView(AppView.DASHBOARD)} />}
          
          {/* Completed Tasks View */}
          {view === AppView.COMPLETED_TASKS && <CompletedTasksScreen tasks={completedTasksAll} onBack={() => setView(AppView.DASHBOARD)} onExport={handleExport} onUncomplete={uncompleteTask} />}

          {/* Draft Tasks View */}
          {view === AppView.DRAFT_TASKS && token && (
            <DraftTasksView 
              token={token} 
              onDraftCountChange={setDraftTasksCount}
            />
          )}

          {/* Settings View */}
          {view === AppView.SETTINGS && user && <SettingsScreen user={user} onLogout={handleLogout} onBack={() => setView(AppView.DASHBOARD)} token={token!} />}

        </div>
      </div>

      {/* Floating Action Button (Desktop) - Only show on Dashboard */}
      {view === AppView.DASHBOARD && (
        <button
          onClick={() => setShowQuickAdd(true)}
          className="hidden md:flex fixed bottom-8 right-8 bg-primary hover:bg-blue-600 text-white p-4 rounded-full shadow-2xl shadow-primary/40 transition-all hover:scale-105 active:scale-95 items-center gap-2 group z-30"
          title="Press Cmd+K"
        >
          <Plus className="w-6 h-6 group-hover:rotate-90 transition-transform" />
          <span className="font-medium pr-1">Add Task</span>
          <span className="ml-1 px-1.5 py-0.5 bg-white/20 rounded text-xs text-white/90 font-mono">⌘K</span>
        </button>
      )}

      {/* Quick Add Modal */}
      <QuickCapture 
        isOpen={showQuickAdd} 
        onClose={() => setShowQuickAdd(false)} 
        onAdd={addTask} 
      />
    </div>
  );
}