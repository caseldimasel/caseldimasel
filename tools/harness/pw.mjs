// Carga Playwright desde la instalación global del entorno (no es una dependencia del tema).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const root = execSync('npm root -g').toString().trim();
const require = createRequire(root + '/');
export const { chromium } = require('playwright');
export const CHROMIUM_PATH = process.env.SD_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
