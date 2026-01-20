export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);

    if (!signal) return;

    /*
     * DOMException("AbortError") is used because it is the standardized error type for
     * aborted async operations in JavaScript.
     * AbortController and AbortSignal were designed for:
     *   fetch(), stream, timer and generic async cancellation.
     *
     * In higher-level application code, catch the rejection to distignuish it from abort and error.
     * catch (err) {
     *   if (err instanceof DOMException && err.name === "AbortError") {
     *     this.logger.info("Operation cancelled.");
     *     return;
     *   }
     *   throw err;
     * }
     */
    if (signal.aborted) {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
