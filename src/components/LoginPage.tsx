import React, { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from '../utils/cn';
import { Reicon } from './ui/reicon';
import { ForgotPasswordDialog } from './ForgotPasswordDialog';
import { Ring } from "@/components/loading-ui/ring";

interface LoginPageProps {
  onLogin: (studentId: string, pass: string) => Promise<boolean>;
  isLoading: boolean;
  errorMessage: string | null;
  onDismissError: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onLogin,
  isLoading,
  errorMessage,
  onDismissError,
}) => {
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginMode, setLoginMode] = useState<'student' | 'teacher'>('student');
  const [switchDirection, setSwitchDirection] = useState(1);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  const handleModeChange = (mode: 'student' | 'teacher') => {
    if (mode === loginMode) return;
    setSwitchDirection(mode === 'student' ? 1 : -1);
    setLoginMode(mode);
    setLocalError(null);
    onDismissError();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    onDismissError();

    const rawId = studentId.trim();
    if (!rawId) {
      setLocalError(`Please enter your ${loginMode} ID.`);
      return;
    }
    if (!password) {
      setLocalError('Please enter your password.');
      return;
    }

    const currentPass = password;
    setPassword('');
    await onLogin(rawId, currentPass);
  };

  const activeError = localError || errorMessage;

  return (
    <div className="relative h-[100dvh] w-[100dvw] overflow-hidden bg-[#0b0b0c] text-[#f5f2eb]">
      {/* Keep the school artwork full-bleed, with a quiet overlay for legibility. */}
      <div className="absolute inset-0" aria-hidden>
        <img
          src="/login-hero.jpg"
          alt=""
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-[#08080a]/45" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#09090b]/95 via-[#09090b]/82 to-[#09090b]/35 md:via-[#09090b]/68 md:to-[#09090b]/12" />
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#09090b]/55 to-transparent" />
      </div>

      <div className="relative z-10 flex h-full w-full flex-col md:flex-row">
        {/* Brand + form column */}
        <section className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-10 sm:px-10 md:px-14 lg:px-20">
          <div className="my-auto w-full max-w-[410px]">
            <div className="mb-8 sm:mb-9">
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl border border-white/20 bg-white p-1 shadow-sm">
                  <img src="/logo.png" alt="" className="h-full w-full object-contain" />
                </div>
                <p className="text-sm font-medium text-[#f5f2eb]/80">
                  MMSS Mohali
                </p>
              </div>

              <h1 className="text-[2.5rem] leading-[1.04] text-[#f8f5ee] sm:text-[2.8rem] [font-family:'Fraunces',Georgia,serif]">
                Sign in
              </h1>
              <p className="mt-3.5 max-w-[36ch] text-[15px] leading-relaxed text-[#f5f2eb]/70">
                Enter your account ID and password to access the portal.
              </p>
            </div>

            <div className="mb-5 flex max-w-[280px] gap-0.5 rounded-lg border border-white/15 bg-black/20 p-0.5" role="tablist" aria-label="Choose account type">
              {(
                [
                  ['student', 'Student', 'user-round'],
                  ['teacher', 'Teacher', 'graduation-cap'],
                ] as const
              ).map(([mode, label, iconName]) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={loginMode === mode}
                  disabled={isLoading}
                  onClick={() => handleModeChange(mode)}
                  className={cn(
                    'flex h-8 w-1/2 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors duration-150',
                    loginMode === mode
                      ? 'bg-white/10 text-[#f5f2eb]'
                      : 'text-[#f5f2eb]/55 hover:bg-white/5 hover:text-[#f5f2eb]/85',
                    'disabled:cursor-not-allowed disabled:opacity-50'
                  )}
                >
                  <Reicon name={iconName} size={14} />
                  {label}
                </button>
              ))}
            </div>

            {activeError && (
              <div className="mb-5 flex items-start gap-3 rounded-xl border border-rose-300/30 bg-rose-950/75 px-4 py-3 text-sm text-rose-100" role="alert">
                <Reicon name="alert-circle" size={16} preset="pulse" className="mt-0.5 shrink-0 text-rose-300" />
                <div className="flex-1 leading-relaxed">{activeError}</div>
              </div>
            )}

            <form className="space-y-5" onSubmit={handleSubmit}>
              <AnimatePresence initial={false} mode="popLayout">
                <motion.div
                  key={loginMode}
                  variants={{
                    enter: {
                      opacity: 0,
                      x: prefersReducedMotion ? 0 : switchDirection * 20,
                    },
                    center: { opacity: 1, x: 0 },
                    exit: {
                      opacity: 0,
                      x: prefersReducedMotion ? 0 : switchDirection * 20,
                    },
                  }}
                  initial={prefersReducedMotion ? false : "enter"}
                  animate="center"
                  exit="exit"
                  transition={{ duration: prefersReducedMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="space-y-5"
                >
                  <div className="space-y-2">
                    <label htmlFor={`login-${loginMode}-id`} className="block text-sm font-medium text-[#f5f2eb]/80">
                      {loginMode === 'teacher' ? 'Teacher ID' : 'Student ID'}
                    </label>
                    <div className="relative">
                      <Reicon
                        name="credit-card"
                        size={16}
                        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#f5f2eb]/45"
                      />
                      <input
                        id={`login-${loginMode}-id`}
                        name={`${loginMode}Id`}
                        type="text"
                        value={studentId}
                        onChange={(e) => setStudentId(e.target.value)}
                        placeholder={`Enter ${loginMode} ID`}
                        disabled={isLoading}
                        autoComplete="username"
                        className={cn(
                          'h-12 w-full rounded-xl border border-white/20 bg-black/25 pl-11 pr-4 text-sm text-[#f8f5ee]',
                          'placeholder:text-[#f5f2eb]/35 outline-none transition-[border-color,background-color,box-shadow] duration-150',
                          'hover:border-white/30 hover:bg-black/30',
                          'focus:border-[#58729b]/85 focus:bg-[#102440]/50 focus:ring-2 focus:ring-[#1e3a5f]/65',
                          'disabled:opacity-50'
                        )}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <label htmlFor="login-password" className="block text-sm font-medium text-[#f5f2eb]/80">
                        Password
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowForgotPassword(true)}
                        disabled={isLoading}
                        className="text-xs font-medium text-[#d5bd94]/90 transition-colors hover:text-[#e8d4b0] focus-visible:outline-none focus-visible:underline disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative">
                      <Reicon
                        name="lock"
                        size={16}
                        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#f5f2eb]/45"
                      />
                      <input
                        id="login-password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        disabled={isLoading}
                        autoComplete="current-password"
                        className={cn(
                          'h-12 w-full rounded-xl border border-white/20 bg-black/25 pl-11 pr-12 text-sm text-[#f8f5ee]',
                          'placeholder:text-[#f5f2eb]/35 outline-none transition-[border-color,background-color,box-shadow] duration-150',
                          'hover:border-white/30 hover:bg-black/30',
                          'focus:border-[#58729b]/85 focus:bg-[#102440]/50 focus:ring-2 focus:ring-[#1e3a5f]/65',
                          'disabled:opacity-50'
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#f5f2eb]/50 transition-colors hover:text-[#f8f5ee] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 cursor-pointer"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        <Reicon name={showPassword ? 'eye-off' : 'eye'} size={16} preset="scale" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>

              <button
                type="submit"
                disabled={isLoading}
                className={cn(
                  'group mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl',
                  'bg-[#f5f2eb] text-[#111114] text-sm font-semibold',
                  'transition-[transform,background-color] duration-150',
                  'hover:bg-white active:scale-[0.99] cursor-pointer',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#111114]',
                  'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100'
                )}
              >
                {isLoading ? (
                  <>
                    <Ring className="size-4" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <span>Sign in</span>
                    <Reicon name="arrow-right" size={16} preset="lift" />
                  </>
                )}
              </button>
            </form>

            <p className="mt-6 text-xs leading-relaxed text-[#f5f2eb]/50">
              Your session is securely verified before the portal opens.
            </p>
          </div>
        </section>

        {/* Preserve the open-artwork half of the desktop split without extra copy. */}
        <div className="pointer-events-none relative hidden flex-1 md:block" aria-hidden />
      </div>

      <ForgotPasswordDialog
        isOpen={showForgotPassword}
        onClose={() => setShowForgotPassword(false)}
        variant="forgot"
        appearance="login"
      />
    </div>
  );
};
