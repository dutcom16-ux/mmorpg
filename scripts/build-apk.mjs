// Builds android/app/build/outputs/apk/debug/app-debug.apk and copies it to dist-apk/.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const win = process.platform === 'win32';
const gradlew = path.resolve('android', win ? 'gradlew.bat' : 'gradlew');
if (!fs.existsSync(gradlew)) {
  console.error('android/ not found. Run "npm run android:add" first.');
  process.exit(1);
}
if (!win) fs.chmodSync(gradlew, 0o755);
const r = spawnSync(gradlew, ['assembleDebug'], { cwd: path.resolve('android'), stdio: 'inherit', shell: win });
if (r.status !== 0) process.exit(r.status ?? 1);
const apk = path.resolve('android/app/build/outputs/apk/debug/app-debug.apk');
fs.mkdirSync('dist-apk', { recursive: true });
fs.copyFileSync(apk, 'dist-apk/chipfall-debug.apk');
console.log('\nDebug APK ready: dist-apk/chipfall-debug.apk');
console.log('Install on a connected device:  adb install -r dist-apk/chipfall-debug.apk');
