// Node-native unit tests for pure layout logic and the MockDiskService contract.
import assert from 'node:assert/strict';
import test from 'node:test';

// Minimal browser globals for MockDiskService in headless Node
const storage = new Map<string, string>();
Object.assign(globalThis, {
  window: globalThis,
  localStorage: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => { storage.set(k, String(v)); },
    removeItem: (k: string) => { storage.delete(k); },
  },
});

import { layoutMap, tw, type MapItems } from '../../src/lib/treemap.ts';
import { MockDiskService } from '../../src/services/mock/mockService.ts';
import type { Cat, MigrationProgress } from '../../src/services/types.ts';

test('treemap layout stays within bounds and separates safety levels in clusters', () => {
  assert.ok(tw('空间地图', 12) > tw('Map', 12), 'CJK characters measure wider than Latin');

  const items: MapItems = {
    win: { id: 'win', v: 80, level: 'L4' },
    pip: { id: 'pip', v: 12, level: 'L1' },
    npm: { id: 'npm', v: 0.4, level: 'L1' },
    yarn: { id: 'yarn', v: 0.3, level: 'L1' },
    hf: { id: 'hf', v: 18, level: 'L2' },
  };
  const cats: Cat[] = [
    { id: 'sys', name: '系统与应用', short: '系统', items: ['win'], cl: '其他' },
    { id: 'tmp', name: '临时文件与缓存', short: '缓存', items: ['pip', 'npm', 'yarn'], cl: '其他缓存' },
    { id: 'ai', name: '本地 AI 模型', short: 'AI', items: ['hf'], cl: '其他' },
  ];
  const W = 828, H = 777;
  const lay = layoutMap(W, H, 100, 500, items, cats);

  assert.equal(lay.free.x, 0);
  assert.equal(lay.free.y, 0);
  assert.equal(lay.free.w, W);
  assert.ok(lay.free.h > 100 && lay.free.h < 200);

  for (const [id, box] of Object.entries(lay.cells)) {
    if (box.merged) continue;
    assert.ok(box.x >= -0.5 && box.y >= lay.free.h - 0.5, `${id} top/left inside canvas`);
    assert.ok(box.x + box.w <= W + 0.5 && box.y + box.h <= H + 0.5, `${id} right/bottom inside canvas`);
  }
});

test('MockDiskService supports custom rule lifecycle, clean/undo, and migration pause/cancel', async () => {
  const svc = new MockDiskService();

  // Custom rule creation & deletion
  const before = await svc.listRules();
  await svc.saveRule({
    id: 'custom_1',
    name: '测试规则',
    on: false,
    sched: 'week',
    lv: 'L2',
    do: '移入回收站 · 可撤销',
    when: [['位置', '下载']],
    last: '尚未运行',
    files: [['demo.zip', 0.5]],
  });
  assert.equal((await svc.listRules()).length, before.length + 1);
  await svc.deleteRule('custom_1');
  assert.equal((await svc.listRules()).length, before.length);

  // Clean & undo round-trip (recycle item + rebuild item)
  const d0 = (await svc.listDrives()).find((d) => d.id === 'C')!;
  const rc = await svc.clean('C', ['installers']);
  assert.equal(rc.items.length, 1);
  assert.ok(rc.bin > 0 && rc.items[0].undoable);
  await svc.undo(rc.id, 'installers');
  const mAfterUndo = await svc.getMapModel('C');
  assert.ok(!mAfterUndo.leaves.find((l) => l.id === 'installers')?.cleaned);
  assert.equal((await svc.listDrives()).find((d) => d.id === 'C')!.free, d0.free);

  const rc2 = await svc.clean('C', ['pip']);
  assert.ok(rc2.freed > 0);

  // Migration start -> status query -> cancel
  const events: MigrationProgress[] = [];
  const off = svc.onMigration((e) => events.push(e));
  await svc.startMigration('m_ollama', 'D:\\models', { link: true, verify: false });
  const status = await svc.getMigrationStatus();
  assert.ok(status && status.moveId === 'm_ollama');
  await svc.cancelMigration('m_ollama');
  assert.equal(await svc.getMigrationStatus(), null);
  assert.equal(events.at(-1)?.state, 'cancelled');
  off();
});
