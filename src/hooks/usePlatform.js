import { useState, useEffect } from 'react';

export function usePlatform() {
  const [platform, setPlatform] = useState({
    isDesktop: false,
    isPWA: false,
    isWeb: true
  });

  useEffect(() => {
    // Check if running in Tauri
    const isDesktop = !!window.__TAURI_IPC__ || navigator.userAgent.includes('Tauri');
    
    // Check if running as Installed PWA
    const isPWA = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

    setPlatform({
      isDesktop,
      isPWA,
      isWeb: !isDesktop && !isPWA
    });
  }, []);

  return platform;
}