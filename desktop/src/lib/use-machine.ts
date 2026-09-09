/**
 * React bindings for `machine.ts`. The only file allowed to bridge a machine
 * into a component — FSM.md §7 rule 1: components own no connection state, they
 * subscribe to something that does.
 *
 * The important part is what these hooks *cannot* express. Every effect here
 * depends on a **string key and nothing else**: never a machine object, never a
 * freshly allocated options bag, never a callback. That is what makes the
 * original re-dial bug structurally unreachable — the effect that owns a
 * connection cannot be re-run by a re-render, because a re-render cannot change
 * a string. Pools and callbacks are read through refs precisely so they can
 * never enter a dependency array.
 *
 * StrictMode's synchronous mount → unmount → mount is handled one level down by
 * {@link MachinePool}'s ref-counting with deferred disposal (FSM.md §2
 * guarantee 4), so `acquire`/`release` here are a plain balanced pair.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Machine, SnapshotOf } from "./machine";

/**
 * `Machine<any, any>` is the only constraint under which `SnapshotOf<M>` infers
 * the concrete state type of a subclass. `Machine<StateShape, EventShape>`
 * would widen it to `StateShape` and lose every discriminant the caller
 * switches on, which is the entire value of these hooks.
 */
type AnyMachine = Machine<any, any>;

/**
 * Subscribe to a single machine.
 *
 * `subscribe` and `getSnapshot` are bound instance properties (see
 * `machine.ts`), so they are stable for the life of the machine and
 * `useSyncExternalStore` never resubscribes on a re-render. Passing the same
 * function as the server snapshot is correct here: machines are client-side
 * only and hold no SSR value.
 */
export function useMachine<M extends AnyMachine>(machine: M): SnapshotOf<M> {
  return useSyncExternalStore(
    machine.subscribe,
    machine.getSnapshot,
    machine.getSnapshot,
  ) as SnapshotOf<M>;
}

/**
 * The slice of {@link MachinePool} (and of `agentFsm.ts`'s `AgentMachinePool`)
 * these hooks need. Structural, so neither pool has to know about React.
 */
export interface MachinePoolLike<M> {
  acquire(key: string): M;
  release(key: string): void;
  peek(key: string): M | null;
}

/** Key-list separator. A control character, so no id can contain one. */
const SEPARATOR = String.fromCharCode(31);

export interface PooledMachine<M extends AnyMachine> {
  machine: M | null;
  state: SnapshotOf<M> | null;
}

const NONE: PooledMachine<never> = { machine: null, state: null };

/**
 * Hold a reference on one pooled machine for as long as `key` is mounted.
 *
 * `key` is the sole dependency. A caller that passes `null` holds nothing, and
 * changing the key releases the old machine before acquiring the new one, so
 * the pool's ref count is exactly the number of mounted consumers.
 */
export function usePooledMachine<M extends AnyMachine>(
  pool: MachinePoolLike<M>,
  key: string | null,
): PooledMachine<M> {
  const poolRef = useRef(pool);
  poolRef.current = pool;
  const [entry, setEntry] = useState<{ key: string; machine: M; state: SnapshotOf<M> } | null>(
    null,
  );

  useEffect(() => {
    if (key === null) {
      setEntry(null);
      return;
    }
    const machine = poolRef.current.acquire(key);
    const sync = () => setEntry({ key, machine, state: machine.getSnapshot() as SnapshotOf<M> });
    sync();
    const unsubscribe = machine.subscribe(sync);
    return () => {
      unsubscribe();
      poolRef.current.release(key);
    };
  }, [key]);

  // One render can pass between a key change and the effect that follows it;
  // reporting the previous machine there would hand a component another agent's
  // state, which is precisely the class of bug this file exists to remove.
  if (key === null || entry === null || entry.key !== key) return NONE as PooledMachine<M>;
  return entry;
}

/**
 * The same contract for a whole set of keys — the roster case.
 *
 * The dependency is the joined key list, so the effect re-runs when the set of
 * agents changes and at no other time. A roster refresh that returns the same
 * ids re-subscribes to nothing.
 */
export function usePooledMachines<M extends AnyMachine>(
  pool: MachinePoolLike<M>,
  keys: readonly string[],
): ReadonlyMap<string, SnapshotOf<M>> {
  const poolRef = useRef(pool);
  poolRef.current = pool;
  const keyList = keys.join(SEPARATOR);
  const [states, setStates] = useState<ReadonlyMap<string, SnapshotOf<M>>>(
    () => new Map<string, SnapshotOf<M>>(),
  );

  useEffect(() => {
    const ids = keyList === "" ? [] : keyList.split(SEPARATOR);
    const machines = ids.map((id) => poolRef.current.acquire(id));
    const sync = () => {
      const next = new Map<string, SnapshotOf<M>>();
      ids.forEach((id, index) => next.set(id, machines[index].getSnapshot() as SnapshotOf<M>));
      setStates(next);
    };
    sync();
    const unsubscribes = machines.map((machine) => machine.subscribe(sync));
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
      for (const id of ids) poolRef.current.release(id);
    };
  }, [keyList]);

  return states;
}
