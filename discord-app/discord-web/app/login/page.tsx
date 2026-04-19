'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClient } from '@dis/api';
import { useDisStore } from '@dis/store';

const api = new ApiClient(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000');

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useDisStore((s) => s.setAuth);

  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res =
        tab === 'login'
          ? await api.login(email, password)
          : await api.register(username, email, password);

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
    <div className="min-h-screen flex items-center justify-center bg-[#313338]">
      <div className="bg-[#2b2d31] p-8 rounded-xl w-full max-w-sm shadow-2xl">
        <h1 className="text-2xl font-bold text-white text-center mb-1">
          {tab === 'login' ? 'Welcome back!' : 'Create an account'}
        </h1>
        <p className="text-[#b5bac1] text-sm text-center mb-6">
          {tab === 'login'
            ? "We're so excited to see you again!"
            : 'Join the conversation.'}
        </p>

        {/* Tab switcher */}
        <div className="flex rounded-lg bg-[#1e1f22] p-1 mb-6 gap-1">
          {(['login', 'register'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(''); }}
              className={`flex-1 py-1.5 rounded text-sm font-medium transition ${
                tab === t
                  ? 'bg-[#5865f2] text-white'
                  : 'text-[#949ba4] hover:text-white'
              }`}
            >
              {t === 'login' ? 'Log In' : 'Register'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {tab === 'register' && (
            <div>
              <label className="block text-xs font-semibold text-[#b5bac1] uppercase mb-1.5">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full bg-[#1e1f22] text-white rounded px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#5865f2]"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-[#b5bac1] uppercase mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full bg-[#1e1f22] text-white rounded px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#5865f2]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#b5bac1] uppercase mb-1.5">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full bg-[#1e1f22] text-white rounded px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#5865f2]"
            />
          </div>

          {error && (
            <p className="text-[#f38ba8] text-sm bg-[#3d1515] rounded px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="bg-[#5865f2] hover:bg-[#4752c4] active:bg-[#3c45a5] text-white font-medium py-2.5 rounded transition disabled:opacity-50 disabled:cursor-not-allowed mt-1"
          >
            {loading
              ? tab === 'login'
                ? 'Logging in…'
                : 'Creating account…'
              : tab === 'login'
              ? 'Log In'
              : 'Register'}
          </button>
        </form>
      </div>
    </div>
  );
}
