/** Match the relative paths returned by UploadsService with native S3 object keys. */
export function normalizeS3Key(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+/g, '/');
}
