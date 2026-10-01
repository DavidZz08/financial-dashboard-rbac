import { useEffect, useState } from 'react';

// Re-renders the caller every `ms` so relative times ("12s ago") stay fresh.
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}
