import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Reicon } from './ui/reicon';
import { reportClientError } from '../sentry';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled React Error:', error, errorInfo);
    reportClientError(error, errorInfo.componentStack || undefined);
  }

  private handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full bg-neutral-50 dark:bg-[#09090b] flex flex-col items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#141417] p-6 shadow-sm flex flex-col items-center text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center">
              <Reicon name="alert-triangle" size={24} />
            </div>
            
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                Something went wrong
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                An unexpected error occurred while displaying your homework dashboard.
              </p>
            </div>

            {this.state.error?.message && (
              <div className="w-full text-left bg-neutral-100 dark:bg-neutral-900 p-3 rounded-lg text-xs font-mono text-neutral-600 dark:text-neutral-400 overflow-x-auto max-h-24">
                {this.state.error.message}
              </div>
            )}

            <button
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:opacity-90 transition-opacity cursor-pointer active:scale-95"
            >
              <Reicon name="refresh-cw" size={14} />
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
