import React from 'react';
import { CheckCircle2, XCircle, Info, AlertCircle, X } from 'lucide-react';

export type AlertType = 'success' | 'error' | 'info' | 'warning';

interface AlertModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  type?: AlertType;
  onClose: () => void;
}

export const AlertModal: React.FC<AlertModalProps> = ({
  isOpen,
  title,
  message,
  type = 'info',
  onClose,
}) => {
  if (!isOpen) return null;

  const icons = {
    success: <CheckCircle2 className="w-6 h-6 text-emerald-400" />,
    error: <XCircle className="w-6 h-6 text-red-400" />,
    info: <Info className="w-6 h-6 text-blue-400" />,
    warning: <AlertCircle className="w-6 h-6 text-amber-400" />,
  };

  const colors = {
    success: {
      bg: 'bg-emerald-900/20',
      border: 'border-emerald-500/50',
      icon: 'text-emerald-400',
    },
    error: {
      bg: 'bg-red-900/20',
      border: 'border-red-500/50',
      icon: 'text-red-400',
    },
    info: {
      bg: 'bg-blue-900/20',
      border: 'border-blue-500/50',
      icon: 'text-blue-400',
    },
    warning: {
      bg: 'bg-amber-900/20',
      border: 'border-amber-500/50',
      icon: 'text-amber-400',
    },
  };

  const colorScheme = colors[type];
  const Icon = icons[type];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className={`bg-surface border ${colorScheme.border} rounded-xl shadow-2xl max-w-md w-full`}>
        <div className="p-6">
          <div className="flex items-start gap-4 mb-4">
            <div className={`p-2 rounded-full ${colorScheme.bg}`}>
              {Icon}
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
              <p className="text-slate-300">{message}</p>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex justify-end mt-6">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-700 text-white hover:bg-slate-600 transition-colors"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
