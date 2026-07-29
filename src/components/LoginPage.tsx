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
    <div className="login-stage relative h-[100dvh] w-[100dvw] overflow-hidden text-[#f4f0e8]">
      {/* Full-bleed visual plane */}
      <div className="absolute inset-0" aria-hidden>
        <img
          src="/login-hero.jpg"
          alt=""
          className="h-full w-full object-cover scale-105 login-hero-drift"
        />
        <div className="absolute inset-0 bg-[#07060a]/55" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#07060a] via-[#07060a]/88 to-[#07060a]/25 md:via-[#07060a]/75 md:to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#07060a] via-transparent to-[#07060a]/40" />
        <div className="absolute inset-0 login-grain opacity-[0.35] mix-blend-overlay pointer-events-none" />
        <div className="absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-[#c4a574]/12 blur-[100px] login-orb" />
        <div className="absolute bottom-0 right-1/4 h-80 w-80 rounded-full bg-[#7a8f9a]/10 blur-[120px] login-orb-delayed" />
      </div>

      <div className="relative z-10 flex h-full w-full flex-col md:flex-row">
        {/* Brand + form column */}
        <section className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10 md:px-14 lg:px-20 overflow-y-auto">
          <div className="w-full max-w-[420px] my-auto login-rise">
            <div className="mb-10 sm:mb-12">
              <div className="mb-8 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-white/95 p-1 shadow-[0_0_0_1px_rgba(196,165,116,0.2)]">
                  <img src="/logo.png" alt="" className="h-full w-full object-contain" />
                </div>
                <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-[#c4a574]/90">
                  Student portal
                </p>
              </div>

              <h1 className="login-display text-[2.75rem] sm:text-5xl leading-[0.95] tracking-[-0.03em] text-[#f7f2e9]">
                MMSS
                <span className="block text-[#c4a574]">Mohali</span>
              </h1>
              <p className="mt-4 max-w-[28ch] text-[15px] leading-relaxed text-[#f4f0e8]/65">
                Your homework, classwork, and messages — in one calm place.
              </p>
            </div>

            {activeError && (
              <div className="mb-5 flex items-start gap-3 rounded-2xl border border-rose-400/30 bg-rose-950/50 px-4 py-3 text-xs text-rose-200 backdrop-blur-md">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
                <div className="flex-1 leading-relaxed">{activeError}</div>
              </div>
            )}

            <form 
              className="space-y-4 p-6 rounded-3xl backdrop-blur-[8px] bg-white/[0.06] border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.12)]" 
              onSubmit={handleSubmit}
            >
              <div className="space-y-2">
                <label htmlFor="login-student-id" className="block pl-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-[#f4f0e8]/55">
                  Student ID
                </label>
                <div className="relative">
                  <CreditCard className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#f4f0e8]/40 pointer-events-none" />
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
                      'h-12 w-full rounded-2xl border border-white/12 bg-white/[0.06] pl-11 pr-4 text-sm text-[#f7f2e9]',
                      'placeholder:text-[#f4f0e8]/35 backdrop-blur-xl outline-none transition-[border-color,box-shadow,background-color] duration-200',
                      'hover:border-white/20 hover:bg-white/[0.08]',
                      'focus:border-[#c4a574]/55 focus:bg-white/[0.09] focus:shadow-[0_0_0_3px_rgba(196,165,116,0.15)]',
                      'disabled:opacity-50'
                    )}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="login-password" className="block pl-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-[#f4f0e8]/55">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#f4f0e8]/40 pointer-events-none" />
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
                      'h-12 w-full rounded-2xl border border-white/12 bg-white/[0.06] pl-11 pr-12 text-sm text-[#f7f2e9]',
                      'placeholder:text-[#f4f0e8]/35 backdrop-blur-xl outline-none transition-[border-color,box-shadow,background-color] duration-200',
                      'hover:border-white/20 hover:bg-white/[0.08]',
                      'focus:border-[#c4a574]/55 focus:bg-white/[0.09] focus:shadow-[0_0_0_3px_rgba(196,165,116,0.15)]',
                      'disabled:opacity-50'
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-[#f4f0e8]/45 transition-colors hover:text-[#f7f2e9] cursor-pointer"
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
                  'group mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl',
                  'bg-[#f4f0e8] text-[#0c0b10] text-sm font-semibold tracking-tight',
                  'shadow-[0_10px_40px_-12px_rgba(244,240,232,0.45)]',
                  'transition-[transform,background-color,box-shadow] duration-200',
                  'hover:bg-white hover:shadow-[0_14px_44px_-10px_rgba(244,240,232,0.55)]',
                  'active:scale-[0.985] cursor-pointer',
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

            <p className="mt-8 text-[11px] leading-relaxed text-[#f4f0e8]/35">
              Use your school student ID and password. First sign-in talks to EduSecure, so it can take a few seconds.
            </p>
          </div>
        </section>

        {/* Desktop: quiet brand line on the open visual */}
        <aside className="pointer-events-none relative hidden flex-1 md:flex md:items-end md:justify-end md:p-10 lg:p-12">
          <p className="login-display max-w-[14ch] text-right text-3xl lg:text-4xl leading-[1.05] tracking-[-0.03em] text-[#f7f2e9]/90 drop-shadow-[0_8px_30px_rgba(0,0,0,0.45)] login-rise-delayed">
            School life,
            <span className="block text-[#c4a574]">simplified.</span>
          </p>
        </aside>
      </div>

      <style>{`
        .login-stage {
          font-family: 'Outfit', ui-sans-serif, system-ui, sans-serif;
          background: #07060a;
        }
        .login-display {
          font-family: 'Fraunces', Georgia, 'Times New Roman', serif;
          font-optical-sizing: auto;
          font-weight: 550;
        }
        .login-grain {
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E");
          background-size: 180px 180px;
        }
        @keyframes loginRise {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes loginDrift {
          from { transform: scale(1.05) translate3d(0, 0, 0); }
          to { transform: scale(1.1) translate3d(-1.5%, -1%, 0); }
        }
        @keyframes loginOrb {
          0%, 100% { opacity: 0.55; transform: translate3d(0, 0, 0); }
          50% { opacity: 0.9; transform: translate3d(12px, -10px, 0); }
        }
        .login-rise {
          animation: loginRise 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .login-rise-delayed {
          animation: loginRise 0.9s cubic-bezier(0.22, 1, 0.36, 1) 0.15s both;
        }
        .login-hero-drift {
          animation: loginDrift 28s ease-in-out alternate infinite;
          will-change: transform;
        }
        .login-orb {
          animation: loginOrb 10s ease-in-out infinite;
        }
        .login-orb-delayed {
          animation: loginOrb 14s ease-in-out 1.5s infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .login-rise,
          .login-rise-delayed,
          .login-hero-drift,
          .login-orb,
          .login-orb-delayed {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
};
