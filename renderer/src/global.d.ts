import type { DesktopAPI } from '../../src/desktop/contracts';
declare global { interface Window { desktop: DesktopAPI } }
export {};
