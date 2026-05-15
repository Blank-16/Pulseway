import type { Metadata } from 'next';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign In' };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-100">Pulseway</h1>
          <p className="mt-2 text-sm text-gray-400">Sign in to your account</p>
        </div>
        <LoginForm />
        <p className="text-center text-sm text-gray-500">
          Don&apos;t have an account?{' '}
          <a href="/auth/register" className="text-brand-500 hover:text-brand-600">
            Register
          </a>
        </p>
      </div>
    </div>
  );
}
