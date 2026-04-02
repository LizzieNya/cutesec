## v3.0.0 - Full React & Tauri Rewrite 🚀

Welcome to the new era of Cute Secure Messenger! This version is a complete architectural rewrite designed for performance, maintainability, and true multi-platform support from a single repository.

### Major Changes:
- ⚛️ **Total React + Vite Rewrite**: The frontend is now fully componentized (`App.jsx`, `ChatTab.jsx`, hooks, and contexts), ditching the old vanilla HTML/JS approach for lightning-fast Vite builds.
- 🦀 **Tauri v2 Foundation**: Removed heavy Electron and separate React Native mobile projects. Now, `npm run tauri android build` generates the `.apk` and `npm run tauri build` generates the `.exe` directly from the same exact code.
- 🏎️ **P2P Race Condition Fixed**: Handled a critical data loss issue where burst-sending peer messages overwrote the local IndexedDB. All incoming/outgoing peer payloads are now buffered effectively.
- 🔥 **"Burner Mode" UX**: As an asynchronous P2P app, UI disclaimers have been added across desktop and mobile views so users know it strictly operates as an OTR (Off The Record) chat when friends connect.
- 🧹 **Codebase Cleanup**: Removed dead code (`MailTab`, `usePlatform`, unused CSS), unified all comments and logic strictly to English, and pruned unused patches/scripts.
- 📱 **Smart Install Banners**: Deeply integrated platform detection (`detectDesktop`, `document.referrer` via TWA) so native `.exe` and `.apk` users never see redundant browser "Install App" banners. 

---

## v2.1.0 - Desktop Stego Security & Compatibility
PC phase completed for stego improvements (Electron desktop uses root web files directly).

### Stego Improvements Active on Desktop:
- 🔐 **Recipient Authorization**: Stego encryption now supports explicit recipients (self + selected contacts). Unauthorized users cannot decrypt.
- 🧾 **Integrity Hardening**: Added payload checksum + stricter post-embed verification.
- 🫥 **Transparent PNG Stability**: Embedding now uses writable pixel mapping to avoid alpha-related corruption.
- 🖼️ **Input Format Expansion**: Decoy/secret/decode uploads now accept PNG, JPG/JPEG, and BMP.
- 💾 **Safe Output Format**: Stego export remains PNG to preserve embedded data integrity.
- 👀 **Decode Preview UX**: Preview is now centered with bounded max size for consistent desktop readability.

### Notes:
- Desktop app loads `index.html` + `app.js` from root, so web-root stego changes are immediately reflected in PC builds.
- Cross-variant parity for PWA/APK assets will be tracked as the next implementation phase.

---

## v2.0.9 - Fresh Look 🎀
We've completely revamped the Desktop experience to feel more like a real app!

### Visual Overhaul:
- 🖥️ **New Desktop Layout**: Desktop app now features a modern **Side Navigation** bar instead of top tabs.
- 📐 **Full Width**: The app now utilizes the full window space for a more immersive and comfortable experience.
- ✨ **Clean Aesthetic**: Removed website-style headers and banners from the desktop view for a cleaner, focused interface.
- 📱 **Web Friendly**: The web version keeps the classic centered layout you know and love.

---

## v2.0.8 - Backup & Restore Functionality
Critical update adding the ability to save your identity and restored it later.

### New Features:
- 💾 **Encrypted Backup**: You can now export ALL your data (Identity, Keyring, Contacts, PGP Keys) into a single encrypted JSON file.
- 📥 **Restore Identity**: Easily import your backup file to restore your full identity and friend list on a new device or after clearing data.
- 🔒 **Security**: Backups are encrypted with AES-GCM and a custom password of your choice.

---

## v2.0.7 - UI Polish for Desktop
Quick fix to ensure the Desktop experience is completely native.

### Changes:
- 🧹 **UI Cleanup**: Removed "Web PWA" and "Platform Recommendation" cards from the Desktop app interface to prevent confusion.
- 💅 **Unified Experience**: The app now properly identifies itself as the Desktop version everywhere.

---

## v2.0.6 - Optimized Desktop Build & UI Fixes
This release focuses on optimizing the desktop experience and ensuring clean separation between the Web (PWA) and Desktop versions.

### Highlights:
- 💻 **Desktop Optimizations**: significantly reduced build size by excluding mobile and PWA assets from the desktop executable.
- 🎨 **Smart UI Adaptation**: The app now intelligently detects the Desktop environment and hides PWA-specific elements like "Install App" banners and "Continue in Browser" buttons.
- 🔗 **Direct Download Links**: Updated in-app download links to point to specific versioned releases for stability.
- ⚡ **Cache Update**: Service Worker cache updated to `v2.0.6` for PWA users.

---

## v2.0.5 - Stability & Performance Fixes
This release addresses critical stability issues reported by users, particularly on devices with limited memory.

### Key Changes:
- ⚡ **Optimized Key Generation**: Removed Web Workers dependency for RSA key generation. This fixes indefinite hanging ("loading your keys") on low-memory devices or restricted environments.
- 🛡️ **Robust Startup**: Wrapped critical startup logic in error boundaries. Corrupted local storage will now show a clear error instead of a white screen freeze.
- 🧹 **Data Integrity**: Added checks for contact data validity to prevent runtime errors.
- 🌐 **PWA Updates**: Service Worker cache version bumped to `v12` to force update for web users.
- 🔒 **Security**: General dependency updates and minor security improvements.
