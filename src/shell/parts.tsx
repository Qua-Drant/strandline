import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/Icon';
import { ATMO_TEXT, atmoOf, C_TOTAL, cx } from '../lib/util';
import { useShell } from './context';

/** "空间紧张 / 偏紧 / 充足" status tag in each page header, keyed off C: free space. */
export function AtmoTag() {
  const { cFree } = useShell();
  const a = atmoOf(cFree);
  return (
    <span className={'atmo-tag t-' + a} role="status" title={'C 盘可用 ' + cFree.toFixed(1) + ' GB · ' + (cFree / C_TOTAL * 100).toFixed(1) + '%'}>
      <i aria-hidden="true" />{ATMO_TEXT[a]}
    </span>
  );
}

/** Page header: breadcrumb, status tag, then page-specific controls. */
export function PageHeader({ crumb, children, tag = true }: { crumb: string[]; children?: ReactNode; tag?: boolean }) {
  return (
    <div className="hdr">
      <nav aria-label="位置" className="crumb">
        {crumb.map((c, i) => (i < crumb.length - 1
          ? [<span key={i} className="muted">{c}</span>, <span key={i + 's'} className="muted" aria-hidden="true">/</span>]
          : <span key={i}>{c}</span>))}
      </nav>
      <span className="grow-1" />
      {tag && <AtmoTag />}
      {children}
    </div>
  );
}

/** Scroll area with the design's custom thin scrollbar wrapper. */
export function Scroll({ className, style, sbh = 88, children, outerStyle }: { className?: string; style?: CSSProperties; sbh?: number; children: ReactNode; outerStyle?: CSSProperties }) {
  return (
    <div className="sbw" style={{ flex: '1 1 auto', ['--sbh' as string]: sbh + 'px', ...outerStyle }}>
      <div className={cx('sbs', className)} style={style}>{children}</div>
      <i className="sbt" aria-hidden="true" />
    </div>
  );
}

/** Render over the whole app window (dialogs, palette). */
export function AppPortal({ children }: { children: ReactNode }) {
  const { appEl } = useShell();
  return appEl ? createPortal(children, appEl) : null;
}

/** Scrim + centered dialog; clicking the scrim closes. */
export function Modal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <AppPortal>
      <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>{children}</div>
    </AppPortal>
  );
}

/** Design's custom checkbox (.cbx). */
export function Cbx({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <span className="cbx" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" className="cbx-in" aria-label={label} checked={checked} disabled={disabled} onChange={onChange} />
      <span className="cbx-box" aria-hidden="true"><Icon name="check" size={10} /></span>
    </span>
  );
}

/** Segmented control with the sliding indicator. */
export function Seg<K extends string | number>({ items, value, onPick, label, className = 'seg' }: { items: [K, string][]; value: K; onPick: (k: K) => void; label: string; className?: string }) {
  const i = Math.max(0, items.findIndex(([k]) => k === value));
  return (
    <div className={className} role="group" aria-label={label}>
      <span className="seg-ind" aria-hidden="true" style={{ translate: i * 100 + '% 0' }} />
      {items.map(([k, l]) => <button key={String(k)} type="button" aria-pressed={k === value} onClick={() => onPick(k)}>{l}</button>)}
    </div>
  );
}
