/**
 * API error with status code and detail message
 */
export class APIError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly detail: string
  ) {
    super(`API Error ${statusCode}: ${detail}`);
    this.name = 'APIError';
    Object.setPrototypeOf(this, APIError.prototype);
  }
}
