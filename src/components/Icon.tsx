import type { CSSProperties } from 'react';
import { ICONS, type IconName } from './icons';

interface Props { name: IconName; size?: number; className?: string; style?: CSSProperties }

/** Hand-drawn icon from the Strandline set. Decorative: always aria-hidden. */
export function Icon({ name, size = 16, className, style }: Props) {
  const ic = ICONS[name];
  const small = ic.vb === '0 0 10 10';
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox={ic.vb}
      fill={small ? undefined : 'currentColor'}
      style={small ? style : { flex: '0 0 auto', ...style }}
      dangerouslySetInnerHTML={{ __html: ic.d }}
    />
  );
}
