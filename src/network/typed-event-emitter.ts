/**
 * Type-safe event emitter with strongly typed event maps.
 * @module typed-event-emitter
 */

import { EventEmitter } from "events";

/**
 * Strongly-typed event emitter for type-safe event-driven architectures.
 *
 * TypedEventEmitter extends Node.js EventEmitter with TypeScript generics to provide
 * compile-time type safety for event registration, listening, and emission. It ensures
 * that event handlers receive correctly typed arguments and prevents runtime errors
 * from incorrect event usage.
 *
 * Key Features:
 * - Compile-time type checking for event names and arguments
 * - Full EventEmitter API compatibility
 * - Generic event map support
 * - Type-safe on(), once(), and emit() methods
 * - IntelliSense support for event names
 *
 * @typeParam Events - Event map interface defining event names and their callback signatures.
 *                    Each property key is an event name, and the value is the callback signature.
 *
 * @remarks
 * This class is fundamental to the event-driven architecture of the distributed RPC
 * system. It provides type safety while maintaining the flexibility and performance
 * of Node.js EventEmitter.
 *
 * @example
 * ```typescript
 * // Define event signatures
 * interface NetworkEvents {
 *   connection: (peer: { address: string; port: number }) => void;
 *   data: (payload: Buffer) => void;
 *   error: (error: Error) => void;
 *   close: () => void;
 * }
 *
 * // Use in network servers
 * class TcpServer extends TypedEventEmitter<NetworkEvents> {
 *   handleConnection(socket: Socket) {
 *     // Type-checked event emission
 *     this.emit("connection", {
 *       address: socket.remoteAddress,
 *       port: socket.remotePort
 *     });
 *   }
 *
 *   receiveData(data: Buffer) {
 *     this.emit("data", data); // Type-checked
 *   }
 * }
 *
 * // Type-safe event listeners
 * const server = new TcpServer();
 *
 * server.on("connection", ({ address, port }) => {
 *   console.log(`Connection from ${address}:${port}`);
 * }); // Type-checked: parameter types verified
 *
 * server.on("data", (payload) => {
 *   console.log("Received:", payload.length, "bytes");
 * }); // Type-checked: payload is Buffer
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
