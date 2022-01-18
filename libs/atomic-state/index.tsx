import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react'
import type { ReactChild } from 'react'

interface DefaultAtomOptions<T> {
  shouldUpdateSelector: <SelectorValue = T>(
    oldValue: SelectorValue,
    newValue: SelectorValue
  ) => boolean
}

interface AtomRef<T> {
  key: string
  defaultState: T
  defaultOptions: DefaultAtomOptions<T>
}

interface DbState {
  [key: string]: any
}

type WatcherFn = (
  oldState: DbState,
  newState: DbState,
  atomRef: AtomRef<any>,
  mutationFn: Function,
  db: Db<any>
) => void

type Subscription = WatcherFn

interface Db<T> {
  state: Readonly<DbState>
  subscriptions: Map<AtomRef<T>['key'], Set<Subscription>>
  activeHooks: Map<AtomRef<T>['key'], number>
  onChange: WatcherFn
}

function noop() {}

function defaultTo<T>(defaultValue: T, value: T) {
  return value === undefined ? defaultValue : value
}

const makeDb = <T,>(
  initialState: T,
  onChange: WatcherFn
): Db<T> => {
  const subscriptions: Db<T>['subscriptions'] = new Map()

  return {
    state: initialState,
    subscriptions,
    activeHooks: new Map(),
    onChange
  }
}

function setState<T>(
  db: Db<T>,
  newState: T,
  atomRef: AtomRef<T>,
  mutationFn: Function
) {
  const oldState = db.state
  db.state = newState

  const subs =
    db.subscriptions.get(atomRef.key) || new Set()
  subs.forEach((fn) =>
    fn(oldState, newState, atomRef, mutationFn, db)
  )

  db.onChange(oldState, newState, atomRef, mutationFn, db)
}

function getState<T>(db: Db<T>) {
  return db.state
}

function subscribe<T>(
  db: Db<T>,
  key: AtomRef<T>['key'],
  fn: WatcherFn
): void {
  const subs = db.subscriptions.get(key)

  if (!subs) {
    db.subscriptions.set(key, new Set())
    subscribe(db, key, fn)
    return
  }

  subs.add(fn)
}

function unsubscribe<T>(
  db: Db<T>,
  key: AtomRef<T>['key'],
  fn: WatcherFn
) {
  const subs = db.subscriptions.get(key)

  if (!subs) {
    return
  }

  subs.delete(fn)

  const shouldCleanup = subs.size === 0
  if (shouldCleanup) {
    db.subscriptions.delete(key)
  }
}

function resetInactiveAtom<T>(_: T, value: T) {
  return value
}

function addActiveHook<T>(db: Db<T>, atomRef: AtomRef<T>) {
  const hookCount = db.activeHooks.get(atomRef.key) || 0
  db.activeHooks.set(atomRef.key, hookCount + 1)
}

function removeActiveHook<T>(
  db: Db<T>,
  atomRef: AtomRef<T>
) {
  const hookCount = db.activeHooks.get(atomRef.key) || 0
  const newHookCount = Math.max(0, hookCount - 1)
  db.activeHooks.set(atomRef.key, newHookCount)

  const isAtomActive = newHookCount > 0
  if (!isAtomActive) {
    setState(
      db,
      {
        ...getState(db),
        [atomRef.key]: atomRef.defaultState
      },
      atomRef,
      resetInactiveAtom
    )
    db.activeHooks.delete(atomRef.key)
  }
}

function resetAtom<T>(_: T, defaultState: T) {
  return defaultState
}

const atomRefBaseDefaultOptions: Readonly<
  DefaultAtomOptions<any>
> = {
  shouldUpdateSelector: (oldValue, newValue) =>
    oldValue !== newValue
}

const defaultContextDb = makeDb<DbState>({}, noop)
const RootContext = createContext(defaultContextDb)

export function atom<T>({
  key,
  defaultState,
  defaultOptions
}: {
  key: AtomRef<T>['key']
  defaultState: AtomRef<T>['defaultState']
  defaultOptions?: Partial<AtomRef<T>['defaultOptions']>
}): Readonly<AtomRef<T>> {
  return {
    key,
    defaultState,
    defaultOptions: {
      ...atomRefBaseDefaultOptions,
      ...defaultOptions
    }
  }
}

export function AtomRoot({
  onChange = noop,
  children
}: {
  onChange?: WatcherFn
  children: ReactChild | ReactChild[]
}) {
  const rootDb = useContext(RootContext)
  const initialDb = useMemo(
    () => makeDb<DbState>({}, onChange),
    [onChange]
  )
  const isNestedAtomRoot = rootDb !== defaultContextDb

  if (
    process.env.NODE_ENV === 'development' &&
    isNestedAtomRoot
  ) {
    console.error(
      'Warning: Application tree may only be wrapped in a single `AtomRoot` component'
    )
  }

  return (
    <RootContext.Provider value={initialDb}>
      {children}
    </RootContext.Provider>
  )
}

export function useReadAtom<T, SelectorValue = T>(
  atomRef: AtomRef<T>,
  selector: (state: T) => SelectorValue,
  shouldUpdateSelector = atomRef.defaultOptions
    .shouldUpdateSelector
) {
  const { key, defaultState } = atomRef
  const rootDb = useContext(RootContext)
  const initialStateSlice = getState(rootDb)[key]
  const [hookState, setHookState] = useState(
    selector(defaultTo(defaultState, initialStateSlice))
  )

  useEffect(() => {
    const watcherFn: WatcherFn = (_, newState) => {
      const stateSlice = newState[key]
      const nextValue = selector(stateSlice)

      if (!shouldUpdateSelector(hookState, nextValue)) {
        return
      }

      setHookState(nextValue)
    }

    addActiveHook(rootDb, atomRef)
    subscribe(rootDb, key, watcherFn)

    return () => {
      removeActiveHook(rootDb, atomRef)
      unsubscribe(rootDb, key, watcherFn)
    }
  }, [
    rootDb,
    key,
    hookState,
    selector,
    shouldUpdateSelector,
    defaultState,
    atomRef
  ])

  return hookState
}

export function useSetAtom<T, U = T>(atomRef: AtomRef<T>) {
  const { key, defaultState } = atomRef
  const rootDb = useContext(RootContext)

  useEffect(() => {
    addActiveHook(rootDb, atomRef)

    return () => {
      removeActiveHook(rootDb, atomRef)
    }
  }, [rootDb, atomRef])

  return useMemo(
    () =>
      <Payload,>(
        // TODO: warn if the mutation function is unnamed
        // because if we write it to a log we won't have any
        // context
        mutationFn: (oldState: U, payload: Payload) => U,
        payload: Payload
      ) => {
        if (
          process.env.NODE_ENV === 'development' &&
          !mutationFn.name
        ) {
          console.error(
            'Warning: This mutation function should be named -',
            mutationFn
          )
        }

        const rootState = getState(rootDb)
        const stateSlice = defaultTo(
          defaultState,
          rootState[key]
        )
        const nextState = {
          ...rootState,
          [key]: mutationFn(stateSlice, payload)
        }
        setState(rootDb, nextState, atomRef, mutationFn)
      },
    [defaultState, rootDb, key, atomRef]
  )
}

export function useResetAtom<T>(atomRef: AtomRef<T>) {
  const mutate = useSetAtom(atomRef)

  return useMemo(() => {
    return () => {
      mutate(resetAtom, atomRef.defaultState)
    }
  }, [mutate, atomRef.defaultState])
}
