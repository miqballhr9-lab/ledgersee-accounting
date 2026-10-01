import * as React from "react"

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onStoreChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY)
  mql.addEventListener("change", onStoreChange)
  return () => mql.removeEventListener("change", onStoreChange)
}

// useSyncExternalStore rather than useState + useEffect: setting state directly in an
// effect is an error under eslint-config-next 16 (react-hooks/set-state-in-effect), and
// a media query is exactly the external store that hook exists for. The server snapshot
// is `false` so SSR renders the desktop layout — same as the old `!!undefined`.
export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  )
}
