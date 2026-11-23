import { useEffect, useState, type AnchorHTMLAttributes } from 'react';

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

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; current?: boolean };

/** <a> pointing at a route; `current` sets aria-current="page". */
export function Link({ to, current, ...rest }: LinkProps) {
  return <a href={'#' + to} aria-current={current ? 'page' : undefined} {...rest} />;
}
