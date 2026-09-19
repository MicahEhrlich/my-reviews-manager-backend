export class AppError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) { super(message); }
}

export class ProviderError extends Error {
  constructor(message: string, public readonly retryable: boolean, public readonly code = 'PROVIDER_ERROR') { super(message); }
}

export function isRetryable(error: unknown): boolean {
  return error instanceof ProviderError ? error.retryable : true;
}
