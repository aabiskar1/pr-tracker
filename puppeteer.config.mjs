import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isCI = process.env.CI === 'true';
const isDebug = process.env.DEBUG === 'true';

// Extension path
const extensionPath = path.join(__dirname, 'dist-chrome');

export const puppeteerConfig = {
  launch: {
    headless: isCI ? false : false, // Extensions don't work in headless mode
    pipe: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      ...(isDebug ? ['--auto-open-devtools-for-tabs'] : []),
      ...(isCI ? ['--disable-gpu', '--disable-dev-shm-usage'] : [])
    ],
    slowMo: isDebug ? 50 : 0,
    devtools: isDebug
  },
  extensionPath
};
