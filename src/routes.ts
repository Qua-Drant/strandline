export const PATHS = {
  overview: '/',
  map: '/map',
  suggest: '/suggest',
  large: '/large',
  dupes: '/dupes',
  rules: '/rules',
  activity: '/activity',
  settings: '/settings',
} as const;

/** Pages reachable from the command palette, in sidebar order. */
export const NAV: [label: string, path: string][] = [
  ['概览', PATHS.overview],
  ['空间地图', PATHS.map],
  ['清理建议', PATHS.suggest],
  ['大文件', PATHS.large],
  ['重复文件', PATHS.dupes],
  ['整理规则', PATHS.rules],
  ['活动', PATHS.activity],
  ['设置', PATHS.settings],
];
