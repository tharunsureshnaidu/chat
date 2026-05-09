'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClient } from '@dis/api';
import { useDisStore } from '@dis/store';
import { Spinner } from '@/components/ui/Spinner';

const api = new ApiClient(
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'
);

type Tab = 'login' | 'register';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useDisStore((s) => s.setAuth);

  const [tab, setTab] = useState<Tab>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const isRegister = tab === 'register';
  const usernameValid = !isRegister || /^[a-zA-Z0-9_]{3,32}$/.test(username);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const passwordValid = password.length >= 8 && !/^\d+$/.test(password);
  const formValid = (isRegister ? usernameValid : true) && emailValid && passwordValid;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading || !formValid) return;
    setError('');
    setLoading(true);
    try {
      const res = isRegister
        ? await api.register(username, email, password)
        : await api.login(email, password);
      localStorage.setItem('token', res.token);
      localStorage.setItem('user', JSON.stringify(res.user));
      api.setToken(res.token);
      setAuth(res.token, res.user);
      router.push('/chat');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-[#313338] relative overflow-hidden">
      {/* Decorative blobs */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-[#5865f2]/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-[#7289da]/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative bg-[#2b2d31] p-8 rounded-2xl w-full max-w-md shadow-2xl border border-white/5">
        <div className="text-center mb-6">
          <div className="inline-flex w-12 h-12 rounded-2xl bg-linear-to-br from-[#5865f2] to-[#7289da] items-center justify-center mb-4 shadow-lg shadow-[#5865f2]/30">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">
            {isRegister ? 'Create an account' : 'Welcome back'}
          </h1>
          <p className="text-[#b5bac1] text-sm mt-1">
            {isRegister
              ? 'Pick a username and start chatting.'
              : "We're glad to see you again."}
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex rounded-lg bg-[#1e1f22] p-1 mb-6 gap-1">
          {(['login', 'register'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setError('');
              }}
              className={`flex-1 py-1.5 rounded text-sm font-semibold transition-colors ${
                tab === t
                  ? 'bg-[#5865f2] text-white shadow'
                  : 'text-[#949ba4] hover:text-white'
              }`}
            >
              {t === 'login' ? 'Log In' : 'Register'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          {isRegister && (
            <Field
              label="Username"
              hint="3–32 chars, letters, numbers, underscores."
              error={username.length > 0 && !usernameValid ? 'Invalid username format.' : ''}
            >
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                spellCheck={false}
                className="w-full bg-[#1e1f22] text-white rounded-lg px-3 py-2.5 text-sm outline-none border border-transparent focus:border-[#5865f2]/50"
              />
            </Field>
          )}

          <Field
            label="Email"
            error={email.length > 0 && !emailValid ? 'Enter a valid email.' : ''}
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full bg-[#1e1f22] text-white rounded-lg px-3 py-2.5 text-sm outline-none border border-transparent focus:border-[#5865f2]/50"
            />
          </Field>

          <Field
            label="Password"
            hint={isRegister ? 'At least 8 characters.' : undefined}
            error={password.length > 0 && !passwordValid ? 'Password must be at least 8 characters and not all digits.' : ''}
          >
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                className="w-full bg-[#1e1f22] text-white rounded-lg px-3 py-2.5 pr-10 text-sm outline-none border border-transparent focus:border-[#5865f2]/50"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#80848e] hover:text-white p-1 rounded"
              >
                {showPassword ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 110-10 5 5 0 010 10zm0-8a3 3 0 100 6 3 3 0 000-6z" />
                  </svg>
                )}
              </button>
            </div>
          </Field>

          {error && (
            <p className="text-[#f38ba8] text-sm bg-[#3d1515] border border-[#ed4245]/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !formValid}
            className="bg-[#5865f2] hover:bg-[#4752c4] active:bg-[#3c45a5] text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-1 flex items-center justify-center gap-2"
          >
            {loading && <Spinner size={14} />}
            {loading
              ? isRegister
                ? 'Creating account…'
                : 'Logging in…'
              : isRegister
              ? 'Create Account'
              : 'Log In'}
          </button>

          <p className="text-center text-xs text-[#80848e] mt-1">
            {isRegister ? (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setTab('login');
                    setError('');
                  }}
                  className="text-[#7289da] hover:underline font-semibold"
                >
                  Log in
                </button>
              </>
            ) : (
              <>
                New here?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setTab('register');
                    setError('');
                  }}
                  className="text-[#7289da] hover:underline font-semibold"
                >
                  Create an account
                </button>
              </>
            )}
          </p>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-[#b5bac1] uppercase tracking-widest mb-1.5">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[11px] text-[#f38ba8] mt-1">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-[#80848e] mt-1">{hint}</p>
      ) : null}
    </div>
  );
}
