import React, { useState } from 'react';
import { Eye, EyeOff, Loader2, AlertCircle, BookOpen, User, Lock, ArrowRight } from 'lucide-react';
import { cn } from '../utils/cn';

interface LoginPageProps {
  onLogin: (studentId: string, pass: string) => Promise<boolean>;
  isLoading: boolean;
  errorMessage: string | null;
  onDismissError: () => void;
}

// --- DASHBOARD UNIFIED INPUT WRAPPER ---

const InputWrapper = ({ children }: { children: React.ReactNode }) => (
  <div className="group relative rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#141417] transition-all duration-200 focus-within:border-neutral-400 dark:focus-within:border-neutral-600 focus-within:ring-2 focus-within:ring-neutral-400/20 dark:focus-within:ring-neutral-600/20 shadow-2xs">
    {children}
  </div>
);

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

    // Pass the raw typed studentId to onLogin; server will strip @manavmangalschool.com safely
    await onLogin(rawId, currentPass);
  };

  const activeError = localError || errorMessage;

  return (
    <div className="h-[100dvh] w-[100dvw] flex flex-col md:flex-row bg-background text-foreground font-sans overflow-hidden">
      {/* Left column: Sign-in Form */}
      <section className="flex-1 flex items-center justify-center p-6 sm:p-12 overflow-y-auto">
        <div className="w-full max-w-md my-auto space-y-8">
          {/* Header Title & Subtitle */}
          <div className="space-y-2">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
              Welcome back
            </h1>
            <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400 font-medium">
              Sign in to see your school homework
            </p>
          </div>

          {/* Error Banner */}
          {activeError && (
            <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-800/50 flex items-start gap-3 text-xs text-rose-700 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">{activeError}</div>
            </div>
          )}

          {/* Form Fields */}
          <form className="space-y-4" onSubmit={handleSubmit}>
            {/* Student ID Field */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 block pl-0.5">
                Student ID
              </label>
              <InputWrapper>
                <div className="relative flex items-center">
                  <User className="w-4 h-4 absolute left-4 text-neutral-400 pointer-events-none" />
                  <input
                    name="studentId"
                    type="text"
                    value={studentId}
                    onChange={(e) => setStudentId(e.target.value)}
                    placeholder="For e.g. guranshbir126"
                    disabled={isLoading}
                    autoComplete="username"
                    className="w-full bg-transparent text-sm h-12 pl-11 pr-4 rounded-2xl focus:outline-none text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 font-normal"
                  />
                </div>
              </InputWrapper>
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 block pl-0.5">
                Password
              </label>
              <InputWrapper>
                <div className="relative flex items-center">
                  <Lock className="w-4 h-4 absolute left-4 text-neutral-400 pointer-events-none" />
                  <input
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    disabled={isLoading}
                    autoComplete="current-password"
                    className="w-full bg-transparent text-sm h-12 pl-11 pr-12 rounded-2xl focus:outline-none text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    className="absolute right-3.5 p-1 rounded-full text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors cursor-pointer"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </InputWrapper>
            </div>

            {/* Primary Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className={cn(
                'w-full h-12 mt-2 rounded-2xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-semibold text-xs sm:text-sm transition-colors duration-200 ease-out shadow-2xs hover:bg-neutral-800 dark:hover:bg-neutral-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2'
              )}
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-white dark:text-neutral-900" />
                  <span>Signing in...</span>
                </span>
              ) : (
                <>
                  <span>Sign in</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Footer Security Badge */}
          <div className="pt-2 text-center text-xs text-neutral-400 dark:text-neutral-500 font-medium flex items-center justify-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5 text-neutral-400" />
            <span>Direct & secure school portal integration</span>
          </div>
        </div>
      </section>

      {/* Right Column: Hero Image */}
      <section className="hidden md:block flex-1 relative p-4">
        <div className="w-full h-full rounded-3xl overflow-hidden relative border border-neutral-200/80 dark:border-neutral-800/80 shadow-2xs bg-neutral-950">
          <img
            src="/login-hero.jpg"
            alt="Fluid Artwork Hero"
            className="w-full h-full object-cover rounded-3xl"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-black/10 pointer-events-none rounded-3xl" />
        </div>
      </section>
    </div>
  );
};
