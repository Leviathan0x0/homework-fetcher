import React, { useState } from 'react';
import { Eye, EyeOff, Loader2, AlertCircle, ArrowRight, CreditCard, Lock } from 'lucide-react';
import { cn } from '../utils/cn';

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
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    onDismissError();

    const rawId = studentId.trim();
    if (!rawId) {
      setLocalError('Please enter your student ID.');
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
            <div className="mb-9 sm:mb-10">
              <div className="mb-8 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl border border-white/20 bg-white p-1">
                  <img src="/logo.png" alt="" className="h-full w-full object-contain" />
                </div>
                <p className="text-sm font-medium text-[#f5f2eb]/80">
                  MMSS Mohali
                </p>
              </div>

              <h1 className="text-[2.5rem] leading-[1.04] text-[#f8f5ee] sm:text-[2.8rem] [font-family:'Fraunces',Georgia,serif]">
                Student sign in
              </h1>
              <p className="mt-4 max-w-[36ch] text-[15px] leading-relaxed text-[#f5f2eb]/70">
                Use your EduSecure student ID and password to access the school portal.
              </p>
            </div>

            {activeError && (
              <div className="mb-5 flex items-start gap-3 rounded-xl border border-rose-300/30 bg-rose-950/75 px-4 py-3 text-sm text-rose-100" role="alert">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
                <div className="flex-1 leading-relaxed">{activeError}</div>
              </div>
            )}

            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label htmlFor="login-student-id" className="block text-sm font-medium text-[#f5f2eb]/80">
                  Student ID
                </label>
                <div className="relative">
                  <CreditCard className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#f5f2eb]/45" />
                  <input
                    id="login-student-id"
                    name="studentId"
                    type="text"
                    value={studentId}
                    onChange={(e) => setStudentId(e.target.value)}
                    placeholder="ternus9"
                    disabled={isLoading}
                    autoComplete="username"
                    className={cn(
                      'h-12 w-full rounded-xl border border-white/20 bg-black/25 pl-11 pr-4 text-sm text-[#f8f5ee]',
                      'placeholder:text-[#f5f2eb]/35 outline-none transition-[border-color,background-color,box-shadow] duration-150',
                      'hover:border-white/30 hover:bg-black/30',
                      'focus:border-[#d5bd94]/70 focus:bg-black/35 focus:ring-2 focus:ring-[#d5bd94]/20',
                      'disabled:opacity-50'
                    )}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="login-password" className="block text-sm font-medium text-[#f5f2eb]/80">
                  Password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#f5f2eb]/45" />
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
                      'focus:border-[#d5bd94]/70 focus:bg-black/35 focus:ring-2 focus:ring-[#d5bd94]/20',
                      'disabled:opacity-50'
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#f5f2eb]/50 transition-colors hover:text-[#f8f5ee] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d5bd94]/50 cursor-pointer"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

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
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Signing you in...</span>
                  </>
                ) : (
                  <>
                    <span>Sign in</span>
                    <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </form>

            <p className="mt-6 text-xs leading-relaxed text-[#f5f2eb]/50">
              Sign-in may take a few seconds while your EduSecure account is verified.
            </p>
          </div>
        </section>

        {/* Preserve the open-artwork half of the desktop split without extra copy. */}
        <div className="pointer-events-none relative hidden flex-1 md:block" aria-hidden />
      </div>
    </div>
  );
};
