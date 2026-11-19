import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  isPermissionError: boolean;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      message: '',
      isPermissionError: false,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let message = error.message || '알 수 없는 오류가 발생했습니다.';
    let isPermissionError = false;
    try {
      const parsed = JSON.parse(message) as { error?: string; operationType?: string; path?: string };
      if (parsed && parsed.error) {
        isPermissionError =
          parsed.error.toLowerCase().includes('permission') ||
          parsed.error.toLowerCase().includes('insufficient');
        message = `${parsed.error}${parsed.path ? ` (${parsed.operationType || 'op'}: ${parsed.path})` : ''}`;
      }
    } catch {
      // Non-JSON error message
    }
    return {
      hasError: true,
      message,
      isPermissionError,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('App ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[100dvh] w-full bg-[#090d16] text-slate-100 flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl bg-slate-900 border border-rose-500/40 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-rose-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h1 className="text-lg font-bold">
                {this.state.isPermissionError
                  ? '클라우드 동기화 권한 오류가 발생했습니다'
                  : '화면을 불러오는 중 오류가 발생했습니다'}
              </h1>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed break-words bg-slate-950/70 border border-slate-800 rounded-lg p-3 font-mono">
              {this.state.message}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold flex items-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                새로고침
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
