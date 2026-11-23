import type { CleanAct, Level, MapAct } from '../services/types';

/** How an item is cleaned, as shown next to it. */
export const ALABEL: Record<MapAct, string> = { rebuild: '删除 · 可重建', recycle: '移入回收站 · 可撤销', empty: '清空 · 不可恢复', setting: '改设置 · 可还原', keep: '' };
export const LVN: Record<Level, string> = { L1: '可重建', L2: '需审阅', L3: '不可恢复' };
export const LVD: Record<Level, string> = { L1: '删了会自动重建，放心清理', L2: '可能还用得到，或会改系统设置', L3: '清空后找不回' };
export const LVL: Record<string, string> = { L1: '可重建', L2: '需审阅', L3: '不可恢复', L4: '保留', mix: '混合' };
export const AGES: [string, number, number][] = [['今天', 0, 0], ['一周内', 1, 7], ['一个月内', 8, 31], ['半年内', 32, 180], ['半年以上', 181, 900]];
export const CLEAN_ACTS: CleanAct[] = ['rebuild', 'recycle', 'setting', 'empty'];
