import { useEffect, useState } from 'react';

/** Minimal hash router: the app is a single window, so #/path is all it needs. */
const read = () => {
  const h = window.location.hash.replace(/^#/, '');
  const [path, query = ''] = h.split('?');
  return { path: path || '/', query: new URLSearchParams(query) };
};

export function useRoute() {
  const [r, setR] = useState(read);
  useEffect(() => {
    const on = () => setR(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

export const navigate = (to: string) => { window.location.hash = to; };
