// Makes the generated Android project able to talk to a development server over plain HTTP
// (http://10.0.2.2:3000 on the emulator, http://<your-PC-IP>:3000 on a phone). Safe to run repeatedly.
import fs from 'node:fs';
import path from 'node:path';

const manifest = path.resolve('android/app/src/main/AndroidManifest.xml');
if (!fs.existsSync(manifest)) {
  console.error('android/ not found. Run "npm run android:add" first.');
  process.exit(1);
}
let xml = fs.readFileSync(manifest, 'utf8');
if (!xml.includes('usesCleartextTraffic')) {
  xml = xml.replace('<application', '<application\n        android:usesCleartextTraffic="true"');
  fs.writeFileSync(manifest, xml);
  console.log('AndroidManifest.xml: enabled cleartext HTTP for the dev server.');
} else {
  console.log('AndroidManifest.xml: cleartext HTTP already enabled.');
}
if (!xml.includes('android.permission.INTERNET')) {
  xml = xml.replace('<application', '<uses-permission android:name="android.permission.INTERNET" />\n    <application');
  fs.writeFileSync(manifest, xml);
}
// Portrait only.
xml = fs.readFileSync(manifest, 'utf8');
if (!xml.includes('android:screenOrientation')) {
  xml = xml.replace(/<activity(\s)/, '<activity android:screenOrientation="portrait"$1');
  fs.writeFileSync(manifest, xml);
  console.log('AndroidManifest.xml: locked to portrait.');
}
