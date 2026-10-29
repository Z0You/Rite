# Rite

Rite is an end-to-end encrypted notes app for Android and the web. It is a fork of
[Standard Notes](https://github.com/standardnotes/app) (AGPL-3.0) with these changes:

| | Standard Notes | Rite |
|---|---|---|
| Paid features (Super notes, nested folders, smart views, Markdown/Code editors, vaults…) | Subscription | **Included for everyone** |
| Where notes sync | Standard Notes' servers, or a self-hosted server | **Your MEGA drive** (free plan works), or any compatible server you choose |
| Authenticator (2FA codes) | Paid, not open source | **Rite's own**, open source, scan QR from camera or photo |
| Spreadsheet | Paid, not open source | **Rite's own**, open source, formulas + CSV import/export |
| Task and Minimal Markdown editors | Paid | Not included (their packages have no open-source license) |

Encryption is unchanged and audited upstream: your password is turned into keys with
Argon2id, and every note is encrypted with XChaCha20-Poly1305 **on your device** before it
is uploaded. MEGA (or any server) only ever stores ciphertext.

---

## 1. Get the Android app (APK)

The APK is built automatically by GitHub Actions — you don't need Android Studio.

1. Put this repository on GitHub (see *Putting Rite on GitHub* below). It must be public:
   Rite is AGPL software, so its source has to be available to anyone you give the app to.
2. Open the repository → **Actions** → **Rite — build Android APK** → **Run workflow**
   (it also runs on every push to `main`).
3. When it finishes (≈20–30 min), open the run and download **Rite-…-apk** under *Artifacts*.
   Unzip it and copy `Rite-x.y.z.apk` to your phone.
4. On the phone, open the APK and allow "Install unknown apps" for your file manager.

To publish a proper release, push a tag such as `v1.0.0`; the APK is then attached to a
GitHub Release automatically.

### Your own signing key (recommended)

Without a key, APKs are signed with the repository's public debug key. That works, but anyone
could build an "update" with the same key. To use your own key, run once on your computer
(Java's `keytool` comes with any JDK):

```bash
keytool -genkeypair -v -keystore rite-release.keystore -alias rite \
  -keyalg RSA -keysize 4096 -validity 10000
```

Keep the file and passwords safe (losing them means users must uninstall to update). Then in
GitHub → **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|---|---|
| `RITE_KEYSTORE_BASE64` | the keystore file as base64 (`base64 -w0 rite-release.keystore`, or on Windows `certutil -encode`) |
| `RITE_KEYSTORE_PASSWORD` | keystore password |
| `RITE_KEYSTORE_ALIAS` | `rite` |
| `RITE_KEYSTORE_KEY_PASSWORD` | key password |

Switching from the debug key to your own key changes the signature, so uninstall the
debug-signed app once before installing the first build signed with your key.

---

## 2. Syncing with MEGA

On the **Create account** or **Sign in** screen, the *Sync with MEGA* box at the top lets you
connect a MEGA account. Then create your Rite account as usual.

- Rite stores everything in one file, **`Rite/rite-vault.json`**, in your MEGA drive, plus one
  backup per day (`rite-vault-backup-YYYY-MM-DD.json`, last 7 days kept).
- **Your Rite password and your MEGA password are different things.** The Rite password
  encrypts your notes and cannot be reset. Use a different one from MEGA's.
- Rite never saves your MEGA password. It keeps only MEGA's session token on the device;
  *Disconnect* removes it. If MEGA ends the session, Rite asks you to connect again.
- Sign in on another device with the same MEGA account and the same Rite email/password,
  and your notes download and decrypt there.
- Notes sync about every 30 seconds and right after you edit.

**Not available with MEGA sync** (they need a full server): file attachments, sharing vaults
with other people, server-side revision history (each device still keeps its own history),
two-factor login for the Rite account, and email backups. Choosing **Advanced options →
Custom server** with a self-hosted Standard Notes–compatible server enables those.

**Proton Drive** is not supported yet: Proton's developer kit is still a preview that Proton
says third-party apps cannot use. Rite's sync layer is pluggable (`VaultStorageInterface`), so a
Proton backend can be added once Proton allows it.

---

## 3. Add your logo

Put a square PNG (ideally 1024×1024, transparent background) somewhere and run:

```bash
pip install pillow
python3 scripts/rite/generate-icons.py --logo path/to/logo.png
```

This regenerates every Android launcher icon (including the adaptive/monochrome ones) and all
web favicons. Commit the changes; the next GitHub build uses them. Running the script without
`--logo` restores the placeholder "R" icon.

Other identity settings:

- App name: `packages/features/src/Domain/Strings/ProductNames.ts` (`AppName`) and
  `packages/mobile/android/app/src/main/res/values/strings.xml`.
- Android app ID: `applicationId "app.rite.notes"` in `packages/mobile/android/app/build.gradle`.
  Change it only before people install the app — a new ID installs as a different app.

---

## 4. Developing

Requirements: Node 22, and Python 3 with Playwright for the end-to-end tests.

```bash
corepack enable          # or use: node .yarn/releases/yarn-3.2.1.cjs
yarn install
yarn build:web           # web app → packages/web/dist
yarn start:web           # dev server
```

Tests:

```bash
(cd packages/api && npx jest src/Domain/Http/Rite)      # sync server: 23 tests
(cd packages/web && npx jest src/javascripts/Rite)      # MEGA storage: 11 tests
node packages/web/rite-editors/tests/run.js            # TOTP (RFC 6238 vectors) + CSV
python3 packages/web/e2e/test_two_devices.py           # two devices syncing through a fake MEGA
python3 packages/web/e2e/test_editors.py               # Authenticator + Spreadsheet in the app
```

Where the Rite code lives:

| Path | What |
|---|---|
| `packages/api/src/Domain/Http/Rite/` | The in-app sync server (`RiteVirtualServer`), vault format, merge logic |
| `packages/web/src/javascripts/Rite/` | MEGA connection and vault storage, sign-in UI |
| `packages/web/rite-editors/` | Authenticator and Spreadsheet editors |
| `packages/web/e2e/` | Browser end-to-end tests |
| `scripts/rite/generate-icons.py` | Icon generator |
| `.github/workflows/rite-android.yml` | APK / web build |

Troubleshooting sync: in the browser console run `window.__riteDebugSync = true`, and every
request the sync engine makes is logged.

---

## 5. License and credits

Rite is licensed under the **GNU AGPL v3** (see `LICENSE`), like Standard Notes, on which it
is based. In practice:

- If you give the app to anyone (APK or website), you must offer them its complete source
  code, including your changes. A public GitHub repository does this.
- Keep the existing copyright and license notices.
- "Standard Notes" is Standard Notes Ltd.'s name; Rite doesn't use it or their logo as its
  own brand. Credit to them stays in `NOTICE` and the code.

Third-party additions: megajs (MIT), x-spreadsheet (MIT), jsQR (Apache-2.0).
