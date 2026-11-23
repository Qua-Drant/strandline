import type { AnchorHTMLAttributes } from 'react';

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; current?: boolean };

/** <a> pointing at a hash route; `current` sets aria-current="page". */
export function Link({ to, current, ...rest }: LinkProps) {
  return <a href={'#' + to} aria-current={current ? 'page' : undefined} {...rest} />;
}
