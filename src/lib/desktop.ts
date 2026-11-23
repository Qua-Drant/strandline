// Window controls for the custom title bar. In the browser demo these are no-ops.
import { getCurrentWindow } from '@tauri-apps/api/window';
import { diskService } from '../services/diskService';

const desktop = diskService.mode === 'tauri';

export const win = {
  desktop,
  minimize: () => { if (desktop) void getCurrentWindow().minimize(); },
  toggleMaximize: () => { if (desktop) void getCurrentWindow().toggleMaximize(); },
  close: () => { if (desktop) void getCurrentWindow().close(); },
};
