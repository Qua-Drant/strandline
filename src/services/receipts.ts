import type { ToastInput } from '../shell/context';
import type { Receipt } from './types';

/** Tell the user what a clean/recycle left alone (protected path, file in use, Recycle Bin too small…). */
export function skippedToast(rc: Receipt, push: (t: ToastInput, ttl?: number) => void) {
  if (!rc.skipped.length) return;
  const first = rc.skipped[0];
  push({ kind: 'err', title: rc.skipped.length + ' 项没有处理', sub: first.name + '：' + first.reason + (rc.skipped.length > 1 ? ' 等' : '') }, 9000);
}
