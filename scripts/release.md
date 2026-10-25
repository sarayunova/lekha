# Releasing Lekha (Windows)

Installed copies check `https://github.com/sarayunova/lekha/releases/latest`
for `latest.yml` on startup and offer to restart once the update has
downloaded. The portable build never updates itself.

1. Bump `version` in `package.json`, commit and push to `main`.
2. Build:

   ```sh
   npx yarn@1.22.22 install --ignore-scripts
   node node_modules/electron/install.js
   npx electron-rebuild
   node build/scripts/build.mjs --nosign --win --x64
   ```

3. Create the release with all four files from `dist_electron/bundled`.
   `latest.yml` and the `.blockmap` are required for auto-update:

   ```sh
   v=1.1.0
   cd dist_electron/bundled
   gh release create v$v --repo sarayunova/lekha --title "Lekha $v" \
     --notes-file notes.md \
     Lekha-Setup-v$v-windows-x64.exe \
     Lekha-Setup-v$v-windows-x64.exe.blockmap \
     Lekha-Portable-v$v-windows-x64.exe \
     latest.yml
   ```

4. Upload copies under version-free names. The download page on
   vyapartools.in links to `releases/latest/download/<name>`, so every release
   needs them:

   ```sh
   cp Lekha-Setup-v$v-windows-x64.exe Lekha-Setup-windows-x64.exe
   cp Lekha-Portable-v$v-windows-x64.exe Lekha-Portable-windows-x64.exe
   gh release upload v$v --repo sarayunova/lekha \
     Lekha-Setup-windows-x64.exe Lekha-Portable-windows-x64.exe
   ```

5. Update `lekha/index.html` in `sarayunova/LiVi-Software-Company-Landingpage`
   (liviverse.com): its links, sizes and SHA-256 checksums name the version, and
   so does the badge on the home page card. Open a pull request there.

Do not mark releases as pre-release or draft; the updater and the download
page only read the latest full release.
