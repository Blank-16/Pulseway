export const ErrorCode = {
  // Auth
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  // Resources
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  // Permissions
  FORBIDDEN: 'FORBIDDEN',
  PLAN_LIMIT_EXCEEDED: 'PLAN_LIMIT_EXCEEDED',
  // Input
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  BAD_REQUEST: 'BAD_REQUEST',
  // Server
  INTERNAL: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static notFound(message = 'Resource not found'): AppError {
    return new AppError(404, ErrorCode.NOT_FOUND, message);
  }

  static forbidden(message = 'Insufficient permissions'): AppError {
    return new AppError(403, ErrorCode.FORBIDDEN, message);
  }

  static conflict(message: string): AppError {
    return new AppError(409, ErrorCode.CONFLICT, message);
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(400, ErrorCode.BAD_REQUEST, message, details);
  }

  static planLimitExceeded(message: string): AppError {
    return new AppError(403, ErrorCode.PLAN_LIMIT_EXCEEDED, message);
  }

  static unauthorized(message = 'Unauthorized'): AppError {
    return new AppError(401, ErrorCode.UNAUTHORIZED, message);
  }
}
