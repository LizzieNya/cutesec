# 🎀 Cute Secure Messenger v3.0

A cute, pastel-themed secure messaging application with military-grade encryption (RSA-OAEP + AES-256-GCM).
Now completely rewritten using **React, Vite, and Tauri v2** for a 100% unified codebase across **Desktop**, **Android (APK)**, and **Web (PWA)**! ✨

## 🌟 New in v3.0 (The React & Tauri Architecture)

- **⚛️ Total React Rewrite:** Moved from vanilla JS/Electron to a modern, lightning-fast React + Vite architecture.
- **🦀 Tauri v2 Core:** We've replaced Electron and React Native! Now, a single codebase builds the Windows `.exe` and the Android `.apk`.
- **🔥 Burner Mode (OTR):** Explicit indicators for volatile P2P environments. Messages queue locally when offline and send the moment your friend connects.
- **📱 PWA Web Version:** Installable securely in your browser (iOS/Android compatible).
- **🖼️ Steganography:** Hide encrypted messages inside cute images (now offloaded to Web Workers!).
- **🔐 PGP Support:** Optional PGP encryption ("Enable PGP Mode" in Settings) for power users.
- **🌎 Unified English Codebase:** Fully translated, dead-code eliminated, and cleanly organized components.

## 🚀 Download & Use

### 💻 Desktop (Windows) & 📱 Mobile (Android)
Check the [Releases](../../releases) tab on GitHub to download the latest `.exe` for Windows and `.apk` for Android.

### 🌐 Web App (PWA)
Visit the live site online!
- **iOS:** Tap Share 📤 -> "Add to Home Screen" (Works offline!).
- **Desktop/Android:** Tap the Install banner to get the standalone app.

## 🛠️ Developer Guide: Compiling the Apps

If you are coming from v2.x (which used Vanilla JS + Electron + React Native folder separations), **welcome to the new monorepo!** We have completely removed Electron and the separate mobile project. Everything is now a single React codebase (`src/`) unified by Tauri v2.

### 0. Prerequisites
Before you build the native executables, you must install the environment:
- **Node.js** (for React/Vite)
- **Rust** (for the Tauri backend)
- **Android Studio & NDK** (only if building the Android `.apk`)
- **macOS + Xcode** (only if building Apple formats like `.app` or `.ipa`)

### 1. Web & PWA 🌐
The web version is the core of the app. It can be run independently of Tauri.
```bash
npm install
npm run dev     # Run locally in browser for UI testing
npm run build   # Compile production web files into the /dist folder
```

### 2. Windows Desktop (.exe) 💻
Tauri wraps the web frontend into a lightweight WebView2 executable.
```bash
npm run tauri dev    # Open the desktop app in development/hot-reload mode
npm run tauri build  # Compile the final .exe installer (Outputs to: src-tauri/target/release/)
```

### 3. Android Mobile (.apk / .aab) 📱
Tauri v2 natively supports building Android apps directly from the web code.
*Note: On Windows, run your terminal as Administrator to allow Symlink creation during the build.*
```bash
npm run tauri android dev    # Run live on a connected Android phone or emulator
# Compile the final .apk (Outputs to: src-tauri/gen/android/... /apk/universal/release/)
npm run tauri android build  
```

### 4. Apple Ecosystem (macOS .app / iOS .ipa) 🍎
Apple strictly restricts iOS/macOS compilation to their own hardware. You must run these commands on a Mac:
```bash
npm run tauri dev           # macOS Desktop app hot-reload
npm run tauri build         # Build the macOS Desktop app
npm run tauri ios dev       # Run on iPhone simulator/device
npm run tauri ios build     # Compile the iOS .ipa app
```

## 🔐 Security Specs

- **Algorithm:** RSA-2048 (OAEP) + AES-256-GCM
- **Key Exchange:** ECDH / QR Code (Offline)
- **Zero Knowledge:** Private keys never leave your device.
- **Steganography:** LSB encoding in PNG images (compatible across all platforms).
- **P2P Transport:** PeerJS (WebRTC) with local state buffering to prevent race conditions.

## 📋 Roadmap & Pending Tasks (To-Do)

- **🍎 iOS & macOS Native Builds:** Building for Apple devices requires macOS and Xcode. A pending task is to run `npm run tauri build` (for macOS `.dmg`/`.app`) and `npm run tauri ios build` (for the iOS `.ipa`, which is the Apple equivalent of an APK) on a physical Mac or via a cloud pipeline.
- **☁️ CI/CD Automation:** Set up GitHub Actions (macOS, Windows, Ubuntu runners) to automatically compile the `.exe`, `.apk`, and `.ipa` binaries in the cloud whenever a new version is pushed, uploading them directly to GitHub Releases.
- **🎨 Platform-Specific Polish:** Continuous UI/UX refinements to ensure the web PWA, Desktop, and Android/iOS experiences feel perfectly native across all screens.

Happy messaging! 🎀
