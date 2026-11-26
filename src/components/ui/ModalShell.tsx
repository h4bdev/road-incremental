import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalShellProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  onClose: () => void;
  ariaLabel?: string;
  testId?: string;
  maxWidthClass?: string;
  heightClass?: string;
  zIndexClass?: string;
  backdropClassName?: string;
  headerRight?: React.ReactNode;
  subHeader?: React.ReactNode;
  children: React.ReactNode;
}

export const ModalShell: React.FC<ModalShellProps> = ({
  title,
  subtitle,
  icon,
  onClose,
  ariaLabel,
  testId,
  maxWidthClass = 'max-w-4xl',
  heightClass = 'h-[calc(100dvh-124px)] sm:h-auto sm:max-h-[84vh]',
  zIndexClass = 'z-40',
  backdropClassName = 'p-0 sm:p-4 pb-[calc(env(safe-area-inset-bottom)+68px)] sm:pb-4',
  headerRight,
  subHeader,
  children,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={`fixed inset-0 ${zIndexClass} flex items-end sm:items-center justify-center ${backdropClassName} bg-slate-950/75 backdrop-blur-sm`}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
        className={`animate-modal-enter w-full ${maxWidthClass} ${heightClass} flex flex-col rounded-t-2xl sm:rounded-2xl bg-[#0b1220] border-t sm:border border-white/[0.09] shadow-2xl overflow-hidden`}
      >
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-4 sm:px-5 py-3 sm:py-3.5 border-b border-white/[0.07] bg-[#080d18]/90 shrink-0">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2.5 min-w-0">
              {icon && (
                <div className="w-8 h-8 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shrink-0">
                  {icon}
                </div>
              )}
              <div className="min-w-0">
                <h2 className="text-sm sm:text-base font-bold text-white truncate font-heading">
                  {title}
                </h2>
                {subtitle && (
                  <p className="text-[11px] sm:text-xs text-slate-400 truncate mt-0.5">
                    {subtitle}
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="sm:hidden min-w-[38px] min-h-[38px] flex items-center justify-center rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.08] text-slate-300 hover:text-white transition-colors cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-2.5 min-w-0 flex-wrap">
            {headerRight}
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="hidden sm:flex min-w-[38px] min-h-[38px] items-center justify-center rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.08] text-slate-300 hover:text-white transition-colors cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {subHeader}

        {children}
      </section>
    </div>
  );
};

export interface SegmentedOption<T extends string> {
  id: T;
  label: React.ReactNode;
  testId?: string;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  fullWidth?: boolean;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className = '',
  fullWidth = false,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={`flex items-center gap-1 p-1 rounded-xl bg-[#070b14] border border-white/[0.08] overflow-x-auto no-scrollbar ${
        fullWidth ? 'w-full' : 'w-full sm:w-auto'
      } ${className}`}
    >
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            data-testid={opt.testId}
            onClick={() => onChange(opt.id)}
            className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center justify-center gap-1.5 ${
              fullWidth ? 'flex-1' : ''
            } ${
              active
                ? 'bg-sky-500 text-slate-950 font-bold shadow-sm'
                : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.05]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
