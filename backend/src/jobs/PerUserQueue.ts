//PerUserQueue.ts
const queues = new Map<string, Promise<any>>();

export function runExclusive<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(userId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  queues.set(userId, run.catch(() => {}));
  return run;
}