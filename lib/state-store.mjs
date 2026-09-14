// One snapshot for legacy and React. Publish only after persistence succeeds.
export function createStateStore(initialState, persist) {
  let state = initialState;
  let pending = false;
  const listeners = new Set();
  const publish = next => {
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async save(next) {
      if (pending) throw Error('Enregistrement en cours.');
      pending = true;
      try {
        const snapshot = structuredClone(next);
        await persist(snapshot);
        publish(snapshot);
      } finally { pending = false; }
    },
    async reload(read) {
      if (pending) throw Error('Enregistrement en cours.');
      pending = true;
      try { publish(await read()); return state; }
      finally { pending = false; }
    },
  };
}
