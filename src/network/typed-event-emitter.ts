import { EventEmitter } from "events";

export class TypedEventEmitter<
  Events extends { [K in keyof Events]: (...args: any[]) => void }
> extends EventEmitter {
  // Typed overloads
  on<K extends keyof Events>(event: K, listener: Events[K]): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  on(event: any, listener: any): this {
    return super.on(event, listener);
  }

  once<K extends keyof Events>(event: K, listener: Events[K]): this;
  once(event: string | symbol, listener: (...args: any[]) => void): this;
  once(event: any, listener: any): this {
    return super.once(event, listener);
  }

  emit<K extends keyof Events>(
    event: K,
    ...args: Parameters<Events[K]>
  ): boolean;
  emit(event: string | symbol, ...args: any[]): boolean;
  emit(event: any, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }
}
