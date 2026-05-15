'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setAccessToken } from '../../../lib/api-client';

export function RegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post<{ data: { accessToken: string } }>(
        '/auth/register',
        form,
        { skipAuth: true },
      );
      setAccessToken(res.data.accessToken);
      router.push('/');
    } catch {
      setError('Registration failed. The email may already be taken.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>
      )}
      {(['name', 'email', 'password'] as const).map((field) => (
        <div key={field}>
          <label className="mb-1.5 block text-xs font-medium text-gray-400 capitalize">
            {field}
          </label>
          <input
            type={field === 'password' ? 'password' : field === 'email' ? 'email' : 'text'}
            value={form[field]}
            onChange={set(field)}
            required
            className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>
      ))}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-brand-500 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
      >
        {loading ? 'Creating account…' : 'Create Account'}
      </button>
    </form>
  );
}
