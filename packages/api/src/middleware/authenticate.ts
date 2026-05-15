import { promisify } from 'node:util';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getConfig } from '@pulseway/config';
import { ErrorCode } from '../errors.js';

export interface AuthenticatedRequest extends Request {
  user: { id: string; email: string };
}

interface JwtPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

const jwtVerifyAsync = promisify<string, string, jwt.VerifyOptions, JwtPayload>(
  jwt.verify as (token: string, secret: string, options: jwt.VerifyOptions, cb: jwt.VerifyCallback<JwtPayload>) => void,
);

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: ErrorCode.UNAUTHORIZED, message: 'Missing authorization header' } });
    return;
  }

  try {
    const token = header.slice(7);
    const payload = await jwtVerifyAsync(token, getConfig().JWT_SECRET, {});
    (req as AuthenticatedRequest).user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    res.status(401).json({ error: { code: ErrorCode.TOKEN_EXPIRED, message: 'Invalid or expired token' } });
  }
}
