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
