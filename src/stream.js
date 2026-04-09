/**
 * @param {Response} response
 * @param {(progress: { percent: number, transferredBytes: number, totalBytes: number }) => void} onDownloadProgress
 * @returns {Response}
 */
export function streamResponse(response, onDownloadProgress) {
  const totalBytes = Number(response.headers.get('content-length')) || 0;
  let transferredBytes = 0;

  const reader = response.body.getReader();

  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        onDownloadProgress({
          percent: 1,
          transferredBytes,
          totalBytes: totalBytes || transferredBytes,
        });
        controller.close();
        return;
      }

      transferredBytes += value.byteLength;
      const percent = totalBytes ? transferredBytes / totalBytes : 0;
      onDownloadProgress({ percent, transferredBytes, totalBytes });
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * @param {Request} request
 * @param {(progress: { percent: number, transferredBytes: number, totalBytes: number }) => void} onUploadProgress
 * @param {BodyInit} [originalBody]
 * @returns {Request}
 */
export function streamRequest(request, onUploadProgress, originalBody) {
  const totalBytes = Number(request.headers.get('content-length')) || 0;
  let transferredBytes = 0;

  const reader = request.body.getReader();

  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        onUploadProgress({
          percent: 1,
          transferredBytes,
          totalBytes: totalBytes || transferredBytes,
        });
        controller.close();
        return;
      }

      transferredBytes += value.byteLength;
      const percent = totalBytes ? transferredBytes / totalBytes : 0;
      onUploadProgress({ percent, transferredBytes, totalBytes });
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: stream,
    duplex: 'half',
    signal: request.signal,
  });
}
