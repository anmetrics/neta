/** @type {unique symbol} */
export const stop = Symbol('neta.stop');

export class RetryMarker {
  /**
   * @param {{ delay?: number, request?: Request }} [options]
   */
  constructor(options) {
    this.options = options;
  }
}
