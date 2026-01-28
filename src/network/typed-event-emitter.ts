/**
 * Type-safe event emitter with strongly typed event maps.
 * @module typed-event-emitter
 */

import { EventEmitter } from "events";

/**
 * EventEmitter with type-safe event handling.
 *
 * Extends Node's EventEmitter with TypeScript generics to ensure
 * event listeners receive correctly typed arguments.
 *
 * @typeParam Events - Event map interface defining event names and their callback signatures.
 * @example
 * ```typescript
 * interface MyEvents {
 *   data: (payload: { id: number; value: string }) => void;
 *   error: (err: Error) => void;
 *   complete: () => void;
 * }
 *
 * class MyService extends TypedEventEmitter<MyEvents> {
 *   emitData(id: number, value: string) {
 *     this.emit("data", { id, value }); // Type-checked
 *   }
 * }
 * ```
 */
export class TypedEventEmitter<
  Events extends { [K in keyof Events]: (...args: any[]) => void },
> extends EventEmitter {
  /**
   * Type-safe event listener registration.
   *
   * @param event - Event name from the Events map.
   * @param listener - Callback function with typed parameters.
   * @returns This instance for method chaining.
   */
  on<K extends keyof Events>(event: K, listener: Events[K]): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  on(event: any, listener: any): this {
    return super.on(event, listener);
  }

  /**
   * Type-safe single-shot event listener registration.
   *
   * @param event - Event name from the Events map.
   * @param listener - Callback function with typed parameters (removed after first emission).
   * @returns This instance for method chaining.
   */
  once<K extends keyof Events>(event: K, listener: Events[K]): this;
  once(event: string | symbol, listener: (...args: any[]) => void): this;
  once(event: any, listener: any): this {
    return super.once(event, listener);
  }

  /**
   * Type-safe event emission.
   *
   * @param event - Event name from the Events map.
   * @param args - Arguments passed to event listeners.
   * @returns True if listeners were called, false otherwise.
   */
  emit<K extends keyof Events>(
    event: K,
    ...args: Parameters<Events[K]>
  ): boolean;
  emit(event: string | symbol, ...args: any[]): boolean;
  emit(event: any, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }
}
