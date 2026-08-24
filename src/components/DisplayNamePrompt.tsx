import React, { useState } from 'react';
import { Reicon } from './ui/reicon';
import { UserAccount } from '../hooks/useHomework';
import { authService } from '../services/api';

interface DisplayNamePromptProps {
  onSaved: (user: UserAccount) => void;
}

export const DisplayNamePrompt: React.FC<DisplayNamePromptProps> = ({ onSaved }) => {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const saveName = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await authService.updateDisplayName(name);
      onSaved(updated);
    } catch (err: any) {
      setError(err?.message || 'Could not save your display name.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-label="Add a display name"
      className="rounded-2xl border border-sky-200/80 bg-sky-50/80 p-4 text-sky-950 shadow-2xs dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-100"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-700 dark:text-sky-300">
          <Reicon name="user-round" size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Add your display name</h2>
          <p className="mt-1 text-xs leading-relaxed text-sky-800/80 dark:text-sky-200/80">
            EduSecure did not provide your name yet. Add the name classmates should see in messages.
            Your EduSecure ID stays private.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && name.trim()) saveName();
              }}
              placeholder="Your name"
              maxLength={40}
              autoComplete="name"
              className="h-9 min-w-0 flex-1 rounded-lg border border-sky-200 bg-white px-3 text-xs text-neutral-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 dark:border-sky-800 dark:bg-neutral-950 dark:text-neutral-100"
            />
            <button
              type="button"
              onClick={saveName}
              disabled={saving || !name.trim()}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-sky-700 px-3 text-xs font-semibold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-sky-500 dark:text-sky-950 dark:hover:bg-sky-400"
            >
              {saving ? <Reicon name="loader" size={14} isLoading className="animate-spin" /> : <Reicon name="check" size={14} />}
              Save name
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">{error}</p>}
        </div>
      </div>
    </section>
  );
};
