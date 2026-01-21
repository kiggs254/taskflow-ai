import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'danger' | 'warning' | 'info';
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  variant = 'warning',
}) => {
  if (!isOpen) return null;

  const variantColors = {
    danger: {
      button: 'bg-red-600 hover:bg-red-500 text-white',
      icon: 'text-red-400',
      border: 'border-red-500/50',
    },
    warning: {
      button: 'bg-amber-600 hover:bg-amber-500 text-white',
      icon: 'text-amber-400',
      border: 'border-amber-500/50',
    },
    info: {
      button: 'bg-blue-600 hover:bg-blue-500 text-white',
      icon: 'text-blue-400',
      border: 'border-blue-500/50',
    },
  };

  const colors = variantColors[variant];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className={`bg-surface border ${colors.border} rounded-xl shadow-2xl max-w-md w-full`}>
        <div className="p-6">
          <div className="flex items-start gap-4 mb-4">
            <div className={`p-2 rounded-full bg-${variant === 'danger' ? 'red' : variant === 'warning' ? 'amber' : 'blue'}-900/20`}>
              <AlertTriangle className={`w-6 h-6 ${colors.icon}`} />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
              <p className="text-slate-300">{message}</p>
            </div>
            <button
              onClick={onCancel}
              className="p-1 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex gap-3 justify-end mt-6">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg bg-slate-700 text-white hover:bg-slate-600 transition-colors"
            >
              {cancelText}
            </button>
            <button
              onClick={onConfirm}
              className={`px-4 py-2 rounded-lg transition-colors ${colors.button}`}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
