import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// electron-builder's `files` config resolves `@nomnomdrive/shared` through the pnpm
// workspace symlink, which electron-builder does not follow when packaging. Replace it
// with a real copy so the built app actually contains the shared package's files.
function replaceWorkspaceSymlinkWithCopy() {
  const sharedLink = path.join(packageDir, 'node_modules/@nomnomdrive/shared');
  if (fs.lstatSync(sharedLink).isSymbolicLink()) {
    const target = fs.realpathSync(sharedLink);
    fs.unlinkSync(sharedLink);
    fs.cpSync(target, sharedLink, { recursive: true });
    console.log('Replaced workspace symlink with copy');
  }
}

// llama-addon.node (from @node-llama-cpp/win-x64) is MSVC-compiled and needs the VC++
// Redistributable at runtime. A clean Windows machine doesn't have it, which surfaces as
// a confusing NoBinaryFoundError. build/installer.nsh bundles and silently installs this
// during setup — fetch it fresh at build time rather than committing a ~25MB binary that
// goes stale.
async function fetchVcRedist() {
  if (process.platform !== 'win32') return;

  const dest = path.join(packageDir, 'build/vc_redist.x64.exe');
  if (fs.existsSync(dest)) return;

  const url = 'https://aka.ms/vs/17/release/vc_redist.x64.exe';
  console.log(`Downloading VC++ Redistributable from ${url}...`);
  await downloadFile(url, dest);
  console.log('Downloaded VC++ Redistributable');
}

// Download to a temp file and rename on success so an interrupted download never leaves a
// truncated vc_redist.x64.exe that the fetchVcRedist() existsSync check would treat as valid
// and silently bundle into the installer.
function downloadFile(url, dest, redirectsLeft = 5) {
  const tmp = `${dest}.download`;
  return new Promise((resolve, reject) => {
    const fail = (err) => {
      fs.rm(tmp, { force: true }, () => reject(err));
    };
    https
      .get(url, (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          res.resume();
          downloadFile(res.headers.location, dest, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Failed to download ${url}: HTTP ${res.statusCode}`));
          return;
        }
        const file = fs.createWriteStream(tmp);
        res.on('error', fail);
        file.on('error', fail);
        file.on('finish', () =>
          file.close(() => fs.rename(tmp, dest, (err) => (err ? fail(err) : resolve()))),
        );
        res.pipe(file);
      })
      .on('error', fail);
  });
}

replaceWorkspaceSymlinkWithCopy();
await fetchVcRedist();
