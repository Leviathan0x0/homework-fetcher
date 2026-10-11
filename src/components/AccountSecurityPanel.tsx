import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  accountSecurityService,
  type DeviceSession,
  type SecurityStatus,
} from '../services/api';
import { Reicon } from './ui/reicon';
import { cn } from '../utils/cn';
import { Button } from './ui/button';

/**
 * Account Security: which devices are signed in, and the two passwords.
 *
 * Three rules this component exists to keep:
 *
 * 1. **A password is never stored.** Every field below lives in local component state and
 *    is handed straight to `fetch`. Nothing here touches `localStorage`,
 *    `sessionStorage`, a cache or an analytics call, and each field is cleared the moment
 *    its form succeeds -- a typed password has no reason to outlive the request that used
 *    it, and leaving it in a re-mounting tree is how it ends up somewhere durable.
 * 2. **The school credential is shown as configured or not, never as a value.** The server
 *    does not have an endpoint that returns it either; that is the point.
 * 3. **Destructive actions confirm first.** Revoking a device and signing out everywhere
 *    both ask for the password again, because the server requires it and because a
 *    mis-click should not end somebody's access.
 */
export const AccountSecurityPanel: React.FC<{
  /** Called after an action that ends this browser's own session. */
  onSignOut?: () => void;
}> = ({ onSignOut }) => {
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, first] = await Promise.all([
        accountSecurityService.getStatus(),
        accountSecurityService.listSessions(),
      ]);
      setStatus(nextStatus);
      setSessions(first.sessions);
      setTotal(first.total);
      setHasMore(first.hasMore);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(typeof err?.message === 'string' ? err.message : 'Could not load your security settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Appends the next page. Keyed on `sessions.length` rather than a page counter: the
   * rows already held *are* the offset, so a revoke that shortened the list cannot
   * leave the button pointing past the end and silently fetching nothing.
   */
  const loadMore = useCallback(async () => {
    if (loadingMore) return; // Duplicate click refused, not queued.
    setLoadingMore(true);
    try {
      const next = await accountSecurityService.listSessions({ offset: sessions.length });
      setSessions((current) => {
        // A row can move between pages if a session was used elsewhere mid-scroll.
        // Keyed dedupe: the same device must not appear twice in the list.
        const seen = new Set(current.map((row) => row.id));
        return [...current, ...next.sessions.filter((row) => !seen.has(row.id))];
      });
      setTotal(next.total);
      setHasMore(next.hasMore);
    } catch (err: any) {
      setLoadError(typeof err?.message === 'string' ? err.message : 'Could not load more devices.');
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, sessions.length]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) {
    return (
      <p className="text-xs text-neutral-500 dark:text-neutral-400" aria-live="polite">
        Loading your devices…
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <DevicesCard
        sessions={sessions}
        total={total}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={loadMore}
        onRefresh={refresh}
        onSignOut={onSignOut}
      />
      <PasswordCard status={status} onRefresh={refresh} onSignOut={onSignOut} />
      <EduSecureCard status={status} onRefresh={refresh} />
      {loadError && (
        <p className="text-xs text-rose-600 dark:text-rose-400" aria-live="polite">
          {loadError}
        </p>
      )}
    </div>
  );
};

// ------------------------------------------------------------------ devices

type RevokeTarget = { scope: 'one' | 'others' | 'all'; sessionId?: string };

/**
 * Must match the server's default. The server clamps whatever it is given, so a
 * mismatch here costs an extra round trip, not correctness -- but the UI's "showing X
 * of Y" copy is only truthful if both sides agree on the page size.
 */
const PAGE_SIZE = 20;

const REVOKE_COPY: Record<RevokeTarget['scope'], { title: string; description: string; done: string }> = {
  one: {
    title: 'Sign out this device?',
    description: 'That device will need to sign in again.',
    done: 'That device has been signed out.',
  },
  others: {
    title: 'Sign out your other devices?',
    description: 'Every other device will need to sign in again. This one stays signed in.',
    done: 'Your other devices have been signed out.',
  },
  all: {
    title: 'Sign out everywhere?',
    description: 'This ends every session, including the one you are using. You will need to sign in again.',
    done: 'You have been signed out everywhere.',
  },
};

const DevicesCard: React.FC<{
  sessions: DeviceSession[];
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onSignOut?: () => void;
}> = ({ sessions, total, hasMore, loadingMore, onLoadMore, onRefresh, onSignOut }) => {
  const [target, setTarget] = useState<RevokeTarget | null>(null);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const openConfirm = (next: RevokeTarget | null) => {
    setNotice(null);
    setError(null);
    setPassword('');
    setTarget(next);
  };

  const confirm = async () => {
    if (!target) return;
    if (!password.trim()) {
      setError('Enter your password to continue.');
      passwordRef.current?.focus();
      return;
    }
    if (submitting) return; // Duplicate submission refused, not queued.
    setSubmitting(true);
    setError(null);
    try {
      if (target.scope === 'one') {
        await accountSecurityService.revokeSession(target.sessionId!, password);
      } else if (target.scope === 'others') {
        await accountSecurityService.revokeOtherSessions(password);
      } else {
        await accountSecurityService.revokeAllSessions(password);
        // The server ended this session and cleared the cookie; hand the sign-out to
        // the shell so the app does not sit on a dead session.
        setPassword('');
        onSignOut?.();
        return;
      }
      setNotice(REVOKE_COPY[target.scope].done);
      setPassword('');
      setTarget(null);
      await onRefresh();
    } catch (err: any) {
      setError(typeof err?.message === 'string' ? err.message : 'Could not sign those devices out.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-labelledby="account-security-devices"
      className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-2xs sm:p-6 dark:border-neutral-800/80 dark:bg-[#111114]"
    >
      <div className="flex items-start gap-3">
        <Reicon name="smartphone" size={17} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h2 id="account-security-devices" className="text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Signed-in devices
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            Anyone signed in here can see this account&apos;s homework. Device names are a best
            guess from the browser, not a verified identity.
          </p>
        </div>
      </div>

      <ul className="mt-5 divide-y divide-neutral-200/80 rounded-xl border border-neutral-200/80 dark:divide-neutral-800/80 dark:border-neutral-800/80">
        {sessions.length === 0 && (
          <li className="px-4 py-4 text-[11px] text-neutral-500 dark:text-neutral-400">
            No devices are signed in.
          </li>
        )}
        {/*
          This browser's own row sorts by recent use, so it is normally on the first
          page -- but it sorts by `last_used_at`, and a session touched from another
          tab moves up, not down. Rather than let its absence read as "not signed in",
          say where it is.
        */}
        {hasMore && !sessions.some((session) => session.current) && (
          <li className="px-4 py-3.5 text-[11px] text-neutral-500 dark:text-neutral-400">
            This device is signed in, but further down the list.
          </li>
        )}
        {sessions.map((session) => (
          <li key={session.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                <span className="truncate">{session.deviceLabel}</span>
                {session.current && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                    This device
                  </span>
                )}
              </p>
              <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                Signed in {formatTimestamp(session.createdAt)} · last used{' '}
                {formatTimestamp(session.lastUsedAt)}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="min-h-9 px-3 text-xs"
              disabled={submitting}
              onClick={() => openConfirm({ scope: 'one', sessionId: session.id })}
            >
              Sign out
            </Button>
          </li>
        ))}
      </ul>

      {/*
        A bounded list that hid the rest would be worse than no list: a user cannot
        revoke a device they cannot see. So the count is always stated, and the button
        to reach the rest is on the page rather than hidden behind the count.
      */}
      {hasMore && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400" aria-live="polite">
            Showing {sessions.length} of {total} devices.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="min-h-10 px-3 text-xs"
            disabled={loadingMore}
            onClick={() => void onLoadMore()}
          >
            {loadingMore ? 'Loading…' : `Show more (${total - sessions.length} left)`}
          </Button>
        </div>
      )}

      {!hasMore && sessions.length > 0 && sessions.length > PAGE_SIZE && (
        <p className="mt-4 text-[11px] text-neutral-500 dark:text-neutral-400">
          All {total} devices are listed.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="min-h-10 px-3 text-xs"
          disabled={submitting}
          onClick={() => openConfirm({ scope: 'others' })}
        >
          <Reicon name="logout" size={14} /> Sign out other devices
        </Button>
        <Button
          variant="destructive"
          size="sm"
          className="min-h-10 px-3 text-xs font-semibold"
          disabled={submitting}
          onClick={() => openConfirm({ scope: 'all' })}
        >
          Sign out everywhere
        </Button>
      </div>

      {target && (
        <ConfirmPrompt
          ref={passwordRef}
          title={REVOKE_COPY[target.scope].title}
          description={REVOKE_COPY[target.scope].description}
          password={password}
          onPasswordChange={setPassword}
          submitting={submitting}
          error={error}
          onCancel={() => openConfirm(null)}
          onConfirm={() => void confirm()}
        />
      )}

      {notice && (
        <p className="mt-3 text-xs text-emerald-600 dark:text-emerald-400" aria-live="polite">
          {notice}
        </p>
      )}
      {error && !target && (
        <p className="mt-3 text-xs text-rose-600 dark:text-rose-400" aria-live="polite">
          {error}
        </p>
      )}
    </section>
  );
};

const ConfirmPrompt: React.FC<{
  ref: React.Ref<HTMLInputElement>;
  title: string;
  description: string;
  password: string;
  onPasswordChange: (value: string) => void;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ ref, title, description, password, onPasswordChange, submitting, error, onCancel, onConfirm }) => {
  const id = useId();
  return (
    <div className="mt-4 rounded-xl border border-neutral-200/80 bg-neutral-50 p-4 dark:border-neutral-800/80 dark:bg-neutral-900/40">
      <p className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">{title}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">{description}</p>
      <label htmlFor={id} className="mt-3 block text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
        Your password
      </label>
      <input
        id={id}
        ref={ref}
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => onPasswordChange(event.target.value)}
        disabled={submitting}
        className="mt-1.5 h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-400/15 disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
      />
      {error && (
        <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-400" aria-live="polite">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button variant="outline" size="sm" className="min-h-10 px-3 text-xs" disabled={submitting} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          size="sm"
          className="min-h-10 px-3 text-xs font-semibold"
          disabled={submitting}
          aria-busy={submitting}
          onClick={onConfirm}
        >
          {submitting ? 'Working…' : 'Confirm'}
        </Button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- passwords

const PasswordCard: React.FC<{
  status: SecurityStatus | null;
  onRefresh: () => Promise<void>;
  onSignOut?: () => void;
}> = ({ status, onRefresh, onSignOut }) => {
  const hasPassword = Boolean(status?.hasMmssPassword);
  const canVerify = Boolean(status?.edusecureVerificationAvailable);
  const [edusecure, setEdusecure] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [show, setShow] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return; // Duplicate submission is refused, not queued.
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      if (hasPassword) {
        await accountSecurityService.changePassword(current, next, confirm);
        setDone('Password changed. Your other devices have been signed out.');
      } else {
        await accountSecurityService.setUpPassword(edusecure, next, confirm);
        setDone('Your MMSS64 password is set. You can sign in with it from now on.');
      }
      // Every typed value is dropped the moment it is no longer needed.
      setEdusecure('');
      setCurrent('');
      setNext('');
      setConfirm('');
      await onRefresh();
    } catch (err: any) {
      setError(typeof err?.message === 'string' ? err.message : 'Could not save your password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="account-security-password"
      className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-2xs sm:p-6 dark:border-neutral-800/80 dark:bg-[#111114]"
    >
      <div className="flex items-start gap-3">
        <Reicon name="lock" size={17} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h2 id="account-security-password" className="text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            MMSS64 password
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            {hasPassword
              ? 'This is the password you use to sign in to MMSS Mohali. It is never sent to the school portal.'
              : 'You currently sign in with your school portal password. Set a separate MMSS64 password to keep the two apart.'}
          </p>
        </div>
      </div>

      {/* Setting up a password needs the portal to confirm the student, so with no
          portal connection there is nothing to submit. The form is withheld rather than
          shown-then-refused: a field that cannot succeed is a trap, not an offer. */}
      {(hasPassword || canVerify) && (
      <form onSubmit={submit} className="mt-5 space-y-3">
        {!hasPassword && (
          <PasswordField
            id="security-edusecure-password"
            label="Your current school portal password"
            hint="Used once to confirm it is you. It is checked with the school portal, then saved so homework can be fetched. It is never used to sign in to MMSS Mohali."
            value={edusecure}
            visible={show}
            autoComplete="current-password"
            onChange={setEdusecure}
            disabled={busy}
          />
        )}
        {hasPassword && (
          <PasswordField
            id="security-current-password"
            label="Your current MMSS64 password"
            value={current}
            visible={show}
            autoComplete="current-password"
            onChange={setCurrent}
            disabled={busy}
          />
        )}
        <PasswordField
          id="security-new-password"
          label={hasPassword ? 'New MMSS64 password' : 'New MMSS64 password'}
          hint="At least 8 characters."
          value={next}
          visible={show}
          autoComplete="new-password"
          onChange={setNext}
          disabled={busy}
        />
        <PasswordField
          id="security-confirm-password"
          label="Confirm new password"
          value={confirm}
          visible={show}
          autoComplete="new-password"
          onChange={setConfirm}
          disabled={busy}
        />

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button type="submit" size="sm" className="min-h-10 px-4 text-xs font-semibold" disabled={busy} aria-busy={busy}>
            {busy ? 'Saving…' : hasPassword ? 'Change password' : 'Set up password'}
          </Button>
          <button
            type="button"
            onClick={() => setShow((value) => !value)}
            className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-500 transition-colors hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40 dark:text-neutral-400 dark:hover:text-neutral-200"
          >
            <Reicon name={show ? 'eye-off' : 'eye'} size={14} />
            {show ? 'Hide passwords' : 'Show passwords'}
          </button>
        </div>
      </form>
      )}

      {!canVerify && !hasPassword && (
        <p className="mt-4 rounded-xl border border-amber-200/80 bg-amber-50/70 p-3 text-[11px] leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
          Setting up a separate password needs your school portal to confirm your details, and
          that connection is not available on this server right now. Everything else on this
          page still works.
        </p>
      )}

      {done && (
        <p className="mt-3 text-xs text-emerald-600 dark:text-emerald-400" aria-live="polite">
          {done}
        </p>
      )}
      {error && (
        <p className="mt-3 text-xs text-rose-600 dark:text-rose-400" aria-live="polite">
          {error}
        </p>
      )}

      {onSignOut && <span className="sr-only" data-testid="sign-out-available" />}
    </section>
  );
};

// ------------------------------------------------------------- credentials

const EduSecureCard: React.FC<{
  status: SecurityStatus | null;
  onRefresh: () => Promise<void>;
}> = ({ status, onRefresh }) => {
  const configured = Boolean(status?.edusecureCredentialConfigured);
  const canVerify = Boolean(status?.edusecureVerificationAvailable);
  const [current, setCurrent] = useState('');
  const [replacement, setReplacement] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [show, setShow] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await accountSecurityService.updateEduSecureCredentials(current, replacement);
      setDone('Your school password has been updated.');
      setCurrent('');
      setReplacement('');
      await onRefresh();
    } catch (err: any) {
      setError(typeof err?.message === 'string' ? err.message : 'Could not update your school password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="account-security-edusecure"
      className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-2xs sm:p-6 dark:border-neutral-800/80 dark:bg-[#111114]"
    >
      <div className="flex items-start gap-3">
        <Reicon name="key" size={17} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h2 id="account-security-edusecure" className="text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            School portal password
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            Used only to fetch homework from EduSecure. It is stored encrypted and never shown
            here — only whether one is saved.
          </p>
        </div>
      </div>

      <p
        className={cn(
          'mt-4 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
          configured
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
            : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
        )}
      >
        <Reicon name={configured ? 'circle-check' : 'circle-alert'} size={13} />
        {configured ? 'Configured' : 'Not configured'}
      </p>

      {canVerify ? (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <PasswordField
            id="security-edusecure-current"
            label="Your MMSS64 password"
            hint="Confirms it is you before the saved credential is replaced."
            value={current}
            visible={show}
            autoComplete="current-password"
            onChange={setCurrent}
            disabled={busy}
          />
          <PasswordField
            id="security-edusecure-replacement"
            label="Your new school portal password"
            value={replacement}
            visible={show}
            autoComplete="new-password"
            onChange={setReplacement}
            disabled={busy}
          />
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button type="submit" size="sm" className="min-h-10 px-4 text-xs font-semibold" disabled={busy} aria-busy={busy}>
              {busy ? 'Saving…' : 'Update school password'}
            </Button>
            <button
              type="button"
              onClick={() => setShow((value) => !value)}
              className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-500 transition-colors hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40 dark:text-neutral-400 dark:hover:text-neutral-200"
            >
              <Reicon name={show ? 'eye-off' : 'eye'} size={14} />
              {show ? 'Hide passwords' : 'Show passwords'}
            </button>
          </div>
        </form>
      ) : (
        <p className="mt-4 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          Updating your school password needs the school portal to confirm the replacement,
          and that connection is not available on this server right now.
        </p>
      )}

      {done && (
        <p className="mt-3 text-xs text-emerald-600 dark:text-emerald-400" aria-live="polite">
          {done}
        </p>
      )}
      {error && (
        <p className="mt-3 text-xs text-rose-600 dark:text-rose-400" aria-live="polite">
          {error}
        </p>
      )}
    </section>
  );
};

// ------------------------------------------------------------------ shared

const PasswordField: React.FC<{
  id: string;
  label: string;
  value: string;
  visible: boolean;
  onChange: (value: string) => void;
  disabled: boolean;
  autoComplete: string;
  hint?: string;
}> = ({ id, label, hint, value, visible, onChange, disabled, autoComplete }) => (
  <div>
    <label htmlFor={id} className="block text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
      {label}
    </label>
    {hint && <p className="mt-0.5 text-[10px] leading-relaxed text-neutral-400 dark:text-neutral-500">{hint}</p>}
    <input
      id={id}
      type={visible ? 'text' : 'password'}
      value={value}
      autoComplete={autoComplete}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="mt-1.5 h-10 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm text-neutral-900 outline-none transition focus:border-neutral-400 focus:bg-white focus:ring-2 focus:ring-neutral-400/15 disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:bg-neutral-900"
    />
  </div>
);

/** Epoch milliseconds as a short, local, human date. */
function formatTimestamp(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'an unknown time';
  try {
    return new Date(value).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return 'an unknown time';
  }
}