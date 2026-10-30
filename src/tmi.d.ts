declare module "tmi.js" {
  interface Tags { [key: string]: any; username?: string; emotes?: Record<string, unknown> }
  class Client {
    constructor(options: unknown);
    on(event: string, handler: (...args: any[]) => void): this;
    connect(): Promise<[string, number]>;
    disconnect(): Promise<[string, number]>;
  }
  const tmi: { Client: typeof Client };
  export default tmi;
}
