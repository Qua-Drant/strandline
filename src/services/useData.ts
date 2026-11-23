import { useCallback, useEffect, useRef, useState } from 'react';

/** Load data from the disk service; `reload` fetches again (e.g. after an action). */
export function useData<T>(load: () => Promise<T>, key = ''): [T | null, () => Promise<void>] {
  const [data, setData] = useState<T | null>(null);
  const fn = useRef(load);
  useEffect(() => { fn.current = load; });
  const reload = useCallback(async () => { setData(await fn.current()); }, []);
  useEffect(() => {
    let live = true;
    void fn.current().then((d) => { if (live) setData(d); });
    return () => { live = false; };
  }, [key]);
  return [data, reload];
}
