import { useMemo, useRef } from 'react'

function shallowCompare(cache: any, value: any) {
  const maybeNewValue = value !== cache

  if (maybeNewValue) {
    const shouldShallowCompare = typeof cache === 'object'

    if (shouldShallowCompare) {
      for (const key of Object.keys(value)) {
        const prev = cache[key]
        const next = value[key]
        const isNewValue = prev !== next

        if (isNewValue) {
          return true
        }
      }

      return false
    }
  }

  return cache !== value
}

/**
 * @public
 * Returns a new function that compares the old return value
 * and new return value. If they are the same, then it will
 * return what was previously returned. This is useful for
 * determining if two different objects are equal to prevent
 * unecessary rerenders.
 */
export function useIsNew<X, Y>(
  inputFn: (x: X) => Y,
  isNewValue: (prev: Y, next: Y) => boolean = shallowCompare
): (x: X) => Y {
  const cache = useRef<Y | null>(null)
  const args = { fn: inputFn, isNewValue }
  const argsRef = useRef(args)
  argsRef.current = args

  const newFn = useMemo(() => {
    function wrappedFn(x: X) {
      const next = argsRef.current.fn(x)
      const shouldUpdateCache =
        cache.current === null ||
        argsRef.current.isNewValue(cache.current, next)

      if (shouldUpdateCache) {
        cache.current = next
      }

      return cache.current as Y
    }

    return wrappedFn
  }, [])

  Object.defineProperty(newFn, 'name', {
    value: inputFn.name
  })

  return newFn
}
