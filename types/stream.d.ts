import type { DownloadProgress, UploadProgress } from './types.js';

export declare function streamResponse(
  response: Response,
  onDownloadProgress: (progress: DownloadProgress) => void,
): Response;

export declare function streamRequest(
  request: Request,
  onUploadProgress: (progress: UploadProgress) => void,
  originalBody?: BodyInit,
): Request;
