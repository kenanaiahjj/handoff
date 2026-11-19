export function retainPendingUploadForToken<T extends { token: string }>(
  pending: T | null,
  tokenInput: string,
) {
  return pending?.token === tokenInput.trim() ? pending : null;
}
