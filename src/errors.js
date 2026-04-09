export class HTTPError extends Error {
  /**
   * @param {Response} response
   * @param {Request} request
   * @param {import('./types.js').NormalizedOptions} options
   */
  constructor(response, request, options) {
    const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
    super(`Request failed with status code ${status}`);
    this.name = 'HTTPError';
    this.response = response;
    this.request = request;
    this.options = options;
    /** @type {unknown} */
    this.data = undefined;
  }
}

export class TimeoutError extends Error {
  /**
   * @param {Request} request
   */
  constructor(request) {
    super('Request timed out');
    this.name = 'TimeoutError';
    this.request = request;
  }
}

export class NetworkError extends Error {
  /**
   * @param {Request} request
   * @param {{ cause?: Error }} [options]
   */
  constructor(request, options) {
    super('Network error', options);
    this.name = 'NetworkError';
    this.request = request;
  }
}

export class ForceRetryError extends Error {
  /**
   * @param {{ delay?: number, request?: Request }} [options]
   */
  constructor(options) {
    super('Force retry');
    this.name = 'ForceRetryError';
    this.customDelay = options?.delay;
    this.customRequest = options?.request;
  }
}

export class SchemaValidationError extends Error {
  /**
   * @param {Array<{ message?: string, path?: Array<string | number | symbol> }>} issues
   */
  constructor(issues) {
    const message = issues.map((i) => i.message ?? 'Unknown validation error').join('; ');
    super(`Schema validation failed: ${message}`);
    this.name = 'SchemaValidationError';
    this.issues = issues;
  }
}
