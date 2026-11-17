import { AsyncLocalStorage } from "node:async_hooks";

let saveOperationTail: Promise<unknown> = Promise.resolve();
const saveOperationContext = new AsyncLocalStorage<boolean>();

/**
 * Runs cloud save file operations one at a time. A task started from inside
 * another gated task runs straight away instead of waiting for itself.
 */
export const runWithHydraSaveGuard = <T>(task: () => Promise<T>) => {
  if (saveOperationContext.getStore()) return task();
  const result = saveOperationTail
    .catch(() => undefined)
    .then(() => saveOperationContext.run(true, task));
  saveOperationTail = result.catch(() => undefined);
  return result;
};
