import type { Metadata } from 'next';
import { RegisterForm } from './RegisterForm';

export const metadata: Metadata = { title: 'Register' };

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-100">Pulseway</h1>
          <p className="mt-2 text-sm text-gray-400">Create your account</p>
        </div>
        <RegisterForm />
        <p className="text-center text-sm text-gray-500">
          Already have an account?{' '}
          <a href="/auth/login" className="text-brand-500 hover:text-brand-600">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
