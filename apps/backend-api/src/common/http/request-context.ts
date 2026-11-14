import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request (or per-job) context for logs, audit and errors. Never holds secrets. */
export interface RequestContext {
  requestId: string;
  userId?: string;
  sessionId?: string;
  estateId?: string;
  app?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
  },
  get(): RequestContext | undefined {
    return storage.getStore();
  },
  /** Adds fields once they are known (e.g. after authentication). */
  assign(fields: Partial<Omit<RequestContext, 'requestId'>>): void {
    const current = storage.getStore();
    if (current) Object.assign(current, fields);
  },
};
