import jwt from 'jsonwebtoken';
import { getConfig } from '@pulseway/config';

export interface JwtPayload {
  sub        : string;
  email      : string;
  workspaceId: string;
  role       : string;
  iat?       : number;
  exp?       : number;
}

/**
 * Signs a JWT with the current secret and embeds kid=current in the header.
 * During rotation, the current secret becomes the new one; previous remains
 * valid until all tokens signed with it expire (max 15 minutes).
 */
export function signToken(payload: JwtPayload): Promise<string> {
  const config = getConfig();
  return new Promise((resolve, reject) => {
    jwt.sign(
      payload,
      config.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '15m', keyid: 'current' },
      (err, token) => {
        if (err || !token) reject(err ?? new Error('JWT sign failed'));
        else resolve(token);
      },
    );
  });
}

/**
 * Verifies a JWT against current secret first, then previous secret.
 * This allows zero-downtime rotation:
 *   1. Set JWT_SECRET_PREVIOUS = old JWT_SECRET
 *   2. Set JWT_SECRET           = new random secret
 *   3. Deploy — existing tokens (signed with old secret) still work until expiry
 *   4. After max token lifetime (15m), remove JWT_SECRET_PREVIOUS
 */
export function verifyToken(token: string): Promise<JwtPayload> {
  const config = getConfig();
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      config.JWT_SECRET,
      { algorithms: ['HS256'] },
      (err, decoded) => {
        if (!err && decoded) { resolve(decoded as JwtPayload); return; }

        // Try previous secret if present
        if (config.JWT_SECRET_PREVIOUS) {
          jwt.verify(
            token,
            config.JWT_SECRET_PREVIOUS,
            { algorithms: ['HS256'] },
            (err2, decoded2) => {
              if (!err2 && decoded2) resolve(decoded2 as JwtPayload);
              else reject(err); // Report original error
            },
          );
        } else {
          reject(err);
        }
      },
    );
  });
}
