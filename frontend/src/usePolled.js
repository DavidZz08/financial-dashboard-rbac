import { useCallback, useEffect, useRef, useState } from 'react';

// Runs `fetcher` now, whenever `deps` change, and every `intervalMs`. Keeps the last good
// value on screen while refreshing or if a refresh fails.
export function usePolled(fetcher, deps, intervalMs, enabled = true) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async (isCurrent = () => true) => {
    try {
      const data = await fetcherRef.current();
      if (isCurrent()) setState({ data, error: null, loading: false });
    } catch (error) {
      if (isCurrent()) setState((s) => ({ ...s, error, loading: false }));
    }
  }, []);

  useEffect(() => {
    let current = true; // guards against late responses from a previous deps/role
    const isCurrent = () => current;
    if (!enabled) {
      setState({ data: null, error: null, loading: false });
      return undefined;
    }
    setState((s) => ({ ...s, loading: true }));
    run(isCurrent);
    const timer = intervalMs ? setInterval(() => run(isCurrent), intervalMs) : null;
    return () => {
      current = false;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, intervalMs, run]);

  return { ...state, reload: () => run() };
}
