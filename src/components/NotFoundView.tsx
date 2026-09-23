import React from 'react';
import { Reicon, Reillustration } from './ui/reicon';

/** Full-screen 404 page shown for unknown URL paths (SPA fallback serves index.html). */
export const NotFoundView: React.FC = () => {
  const goHome = () => {
    window.history.replaceState({}, '', '/');
    // Pathname drives the 404 decision at mount, so a fresh load renders the app.
    window.location.assign('/');
  };

  return (
    <div className="min-h-screen w-full bg-[#f8f8f8] dark:bg-[#09090b] flex flex-col items-center justify-center p-4">
      <div className="flex flex-col items-center text-center space-y-5 max-w-md">
        <Reillustration name="page-not-found" size="xl" />

        <div className="space-y-1.5">
          <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            Page not found
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            The page you're looking for doesn't exist or has been moved.
          </p>
        </div>

        <button
          type="button"
          onClick={goHome}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:opacity-90 transition-opacity cursor-pointer active:scale-95"
        >
          <Reicon name="arrow-left" size={14} />
          Back to home
        </button>
      </div>
    </div>
  );
};

export default NotFoundView;
