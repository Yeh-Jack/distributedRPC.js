/**
 * Abort signal utilities for cancellable operations.
 * @module abort-aware
 */

/**
 * Checks if an error is an AbortError from an AbortSignal cancellation.
 *
 * @param err - The error to check.
 * @returns True if the error is a DOMException with name "AbortError".
 * @example
 * ```typescript
 * try {
 *   await operation();
 * } catch (err) {
 *   if (isAbortError(err)) {
 *     console.log("Operation was cancelled");
 *     return;
 *   }
 *   throw err;
 * }
 * ```
 */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * Creates a sleep promise that can be aborted via AbortSignal.
 *
 * @param ms - Number of milliseconds to sleep.
 * @param signal - Optional AbortSignal to cancel the sleep.
 * @returns Promise that resolves after ms milliseconds or rejects on abort.
 * @throws {DOMException} Throws DOMException with name "AbortError" if signal is aborted.
 * @example
 * ```typescript
 * // Simple sleep
 * await sleep(5000);
 *
 * // Abortable sleep
 * const controller = new AbortController();
 * await sleep(5000, controller.signal);
 * controller.abort(); // Cancels the sleep
 * ```
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    if (!signal) {
      setTimeout(resolve, ms);
      return;
    }

    /*
     * DOMException("AbortError") is used because it is the standardized error type for
     * aborted async operations in JavaScript.
     * AbortController and AbortSignal were designed for:
     *   fetch(), stream, timer and generic async cancellation.
     *
     * In higher-level application code, catch the rejection to distinguish it from abort and error.
     * catch (err) {
     *   if (err instanceof DOMException && err.name === "AbortError") {
     *     this.logger.info("Operation cancelled.");
     *     return;
     *   }
     *   throw err;
     * }
     */
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = setTimeout(resolve, ms);

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
