import React, { useEffect } from 'react';
import { CheckCircle2, X, Info, AlertCircle, Mail, MessageSquare, Hash } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type?: ToastType;
  duration?: number;
}

interface ToastNotificationProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

export const ToastNotification: React.FC<ToastNotificationProps> = ({ toast, onRemove }) => {
  useEffect(() => {
    const duration = toast.duration || 5000;
    const timer = setTimeout(() => {
      onRemove(toast.id);
    }, duration);

    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onRemove]);

  const icons = {
    success: <CheckCircle2 className="w-5 h-5 text-emerald-400" />,
    error: <X className="w-5 h-5 text-red-400" />,
    info: <Info className="w-5 h-5 text-blue-400" />,
    warning: <AlertCircle className="w-5 h-5 text-amber-400" />,
  };

  const colors = {
    success: 'bg-emerald-900/90 border-emerald-500/50 text-emerald-100',
    error: 'bg-red-900/90 border-red-500/50 text-red-100',
    info: 'bg-blue-900/90 border-blue-500/50 text-blue-100',
    warning: 'bg-amber-900/90 border-amber-500/50 text-amber-100',
  };

  const type = toast.type || 'info';
  const Icon = icons[type];

  // Detect source from message
  const getSourceIcon = () => {
    if (toast.message.includes('Gmail') || toast.message.includes('📧')) {
      return <Mail className="w-4 h-4" />;
    }
    if (toast.message.includes('Telegram') || toast.message.includes('💬')) {
      return <MessageSquare className="w-4 h-4" />;
    }
    if (toast.message.includes('Slack') || toast.message.includes('💼')) {
      return <Hash className="w-4 h-4" />;
    }
    return null;
  };

  const sourceIcon = getSourceIcon();

  return (
    <div
      className={`${colors[type]} border p-4 rounded-lg shadow-xl flex items-start gap-3 animate-in slide-in-from-right duration-300 pointer-events-auto min-w-[300px] max-w-sm`}
    >
      <div className="flex-shrink-0 mt-0.5">
        {sourceIcon || Icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium break-words">{toast.message}</p>
      </div>
      <button
        onClick={() => onRemove(toast.id)}
        className="flex-shrink-0 p-1 rounded hover:bg-black/20 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onRemove }) => {
  return (
    <div className="fixed top-20 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <ToastNotification key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
};
