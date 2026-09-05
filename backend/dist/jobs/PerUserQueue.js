//PerUserQueue.ts
const queues = new Map();
export function runExclusive(userId, fn) {
    const prev = queues.get(userId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    queues.set(userId, run.catch(() => { }));
    return run;
}
//# sourceMappingURL=PerUserQueue.js.map