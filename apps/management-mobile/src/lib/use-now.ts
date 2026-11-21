import { useEffect, useState } from 'react';

/** Current time, ticking every `intervalMs`, for live timers such as "time since SOS". */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
