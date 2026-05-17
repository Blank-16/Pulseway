import { Router } from 'express';
import { z } from 'zod';
import { AuthService } from '../services/AuthService.js';
import { authenticate } from '../middleware/authenticate.js';
import { handler, authHandler } from '../middleware/handler.js';
import { validateBody } from '../middleware/validate-body.js';
import { AppError, ErrorCode } from '../errors.js';
import { PasswordResetService } from '../services/PasswordResetService.js';

const RegisterSchema = z.object({
  name    : z.string().min(1).max(100).trim(),
  email   : z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
});

const LoginSchema = z.object({
  email   : z.string().email().toLowerCase(),
  password: z.string().min(1),
});

const VerifyEmailSchema = z.object({
  token: z.string().min(1),
});


const ForgotPasswordSchema = z.object({ email: z.string().email().toLowerCase() });
const ResetPasswordSchema = z.object({
  token   : z.string().min(1),
  password: z.string().min(8).max(128),
});

const REFRESH_COOKIE = 'pulseway_refresh';

export function authRoutes(): Router {
  const router      = Router();
  const authService = new AuthService();

  router.post('/register',
    handler(validateBody(RegisterSchema)),
    handler(async (req, res) => {
      const { accessToken, refreshToken, user, workspace } = await authService.register(
        req.body.email,
        req.body.password,
        req.body.name,
      );
      authService.setRefreshCookie(res, refreshToken);
      res.status(201).json({ data: { accessToken, user, workspace } });
    }),
  );

  router.post('/login',
    handler(validateBody(LoginSchema)),
    handler(async (req, res) => {
      const { accessToken, refreshToken, user, workspace } = await authService.login(
        req.body.email,
        req.body.password,
      );
      authService.setRefreshCookie(res, refreshToken);
      res.json({ data: { accessToken, user, workspace } });
    }),
  );

  router.post('/refresh', handler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!token) {
      res.status(401).json({ error: { code: ErrorCode.UNAUTHORIZED, message: 'No refresh token' } });
      return;
    }
    const { accessToken, refreshToken } = await authService.refresh(token);
    // Rotate the cookie with the new token
    authService.setRefreshCookie(res, refreshToken);
    res.json({ data: { accessToken } });
  }));

  router.post('/logout', handler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (token) await authService.logout(token);
    authService.clearRefreshCookie(res);
    res.json({ data: { ok: true } });
  }));

  router.post('/verify-email',
    handler(validateBody(VerifyEmailSchema)),
    handler(async (req, res) => {
      await authService.verifyEmail(req.body.token);
      res.json({ data: { ok: true } });
    }),
  );


  const passwordResetService = new PasswordResetService();

  router.post('/forgot-password',
    handler(validateBody(ForgotPasswordSchema)),
    handler(async (req, res) => {
      // Always 200 — never reveal whether email exists
      await passwordResetService.requestReset(req.body.email).catch(() => null);
      res.json({ data: { ok: true } });
    }),
  );

  router.post('/reset-password',
    handler(validateBody(ResetPasswordSchema)),
    handler(async (req, res) => {
      await passwordResetService.resetPassword(req.body.token, req.body.password);
      res.json({ data: { ok: true } });
    }),
  );

  router.post('/resend-verification',
    handler(authenticate),
    authHandler(async (req, res) => {
      await authService.resendVerificationEmail(req.user.id);
      res.json({ data: { ok: true } });
    }),
  );

  return router;
}
