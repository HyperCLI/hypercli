/**
 * API error with status code and detail message
 */
export class APIError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly detail: string,
    public readonly method?: string,
    public readonly url?: string,
    public readonly responseText?: string
  ) {
    const context = [method, url].filter(Boolean).join(' ');
    super(`API Error ${statusCode}${context ? ` (${context})` : ''}: ${detail}`);
    this.name = 'APIError';
    Object.setPrototypeOf(this, APIError.prototype);
  }
}
