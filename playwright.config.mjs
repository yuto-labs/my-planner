// 画面を実際に操作する自動テスト(npm run e2e)の設定。
// スマホ(タッチ操作あり)の画面で、主な画面の表示と、手作業でしか確かめられなかった操作を確認する。
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    ...devices['Pixel 7'],
    baseURL: 'http://127.0.0.1:5510',
    // Service Workerは更新時に画面を再読み込みするため、テスト中は止める(結果が安定しない)。
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'node scripts/static-server.mjs 5510',
    url: 'http://127.0.0.1:5510/index.html',
    reuseExistingServer: !process.env.CI,
  },
});
