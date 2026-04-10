export class HTTPError extends Error {
  /**
   * @param {Response} response
   * @param {Request} request
   * @param {import('../types/types.js').NormalizedOptions} options
   */
  constructor(response, request, options) {
    const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
    const url = request.url ? ` [${request.method} ${request.url}]` : '';
    super(`Request failed with status code ${status}${url}`);
    this.name = 'HTTPError';
    this.code = 'ERR_HTTP_ERROR';
    this.status = response.status;
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
    const url = request.url ? ` [${request.method} ${request.url}]` : '';
    super(`Request timed out${url}`);
    this.name = 'TimeoutError';
    this.code = 'ERR_TIMEOUT';
    this.request = request;
  }
}

export class NetworkError extends Error {
  /**
   * @param {Request} request
   * @param {{ cause?: Error }} [options]
   */
  constructor(request, options) {
    const url = request.url ? ` [${request.method} ${request.url}]` : '';
    super(`Network error${url}`, options);
    this.name = 'NetworkError';
    this.code = 'ERR_NETWORK';
    this.request = request;
  }
}

export class ForceRetryError extends Error {
  /**
   * @param {{ delay?: number, request?: Request }} [options]
   */
  constructor(options) {
    super('Force retry from hook');
    this.name = 'ForceRetryError';
    this.code = 'ERR_FORCE_RETRY';
    this.customDelay = options?.delay;
    this.customRequest = options?.request;
  }
}

export class SchemaValidationError extends Error {
  /**
   * @param {Array<{ message?: string, path?: Array<string | number | symbol> }>} issues
   */
  constructor(issues) {
    const message = issues.map((i) => {
      const path = i.path?.length ? ` at ${i.path.join('.')}` : '';
      return (i.message ?? 'Unknown validation error') + path;
    }).join('; ');
    super(`Schema validation failed: ${message}`);
    this.name = 'SchemaValidationError';
    this.code = 'ERR_SCHEMA_VALIDATION';
    this.issues = issues;
  }
}
