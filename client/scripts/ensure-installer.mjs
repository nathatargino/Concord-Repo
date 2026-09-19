import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const targetDir = path.resolve(__dirname, '../public');
const targetFile = path.join(targetDir, 'Concord-Setup.exe');
const DOWNLOAD_URL = 'https://github.com/nathatargino/Concord-Repo/releases/download/v1.0.88/Concord-Setup.exe';

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Concord-Installer-Fetcher' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(downloadFile(res.headers.location, dest));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download installer: HTTP ${res.statusCode}`));
      }
      const fileStream = fs.createWriteStream(dest);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });
      fileStream.on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    }).on('error', reject);
  });
}

async function main() {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let needDownload = true;
  if (fs.existsSync(targetFile)) {
    const stats = fs.statSync(targetFile);
    // Real installer is ~161 MB. LFS pointer is < 1 KB.
    if (stats.size > 10 * 1024 * 1024) {
      console.log(`[ensure-installer] Concord-Setup.exe is already present and valid (${(stats.size / (1024 * 1024)).toFixed(2)} MB).`);
      needDownload = false;
    } else {
      console.log(`[ensure-installer] Concord-Setup.exe exists but size is only ${stats.size} bytes (likely Git LFS pointer). Downloading full binary...`);
    }
  } else {
    console.log('[ensure-installer] Concord-Setup.exe not found in public/. Downloading...');
  }

  if (needDownload) {
    console.log(`[ensure-installer] Fetching from ${DOWNLOAD_URL}...`);
    await downloadFile(DOWNLOAD_URL, targetFile);
    const stats = fs.statSync(targetFile);
    console.log(`[ensure-installer] Successfully downloaded Concord-Setup.exe (${(stats.size / (1024 * 1024)).toFixed(2)} MB).`);
  }
}

main().catch((err) => {
  console.error('[ensure-installer] Error ensuring installer:', err);
});
