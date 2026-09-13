import { useCallback } from 'react';
import type { ProviderName, PreferenceKey } from '../../shared/ipc-types';

// Typed wrapper around window.electronAPI.invoke
declare global {
  interface Window {
    electronAPI: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> };
    appVersion: { version: string };
  }
}

export function useSettings() {
  const hasSecret = useCallback(async (key: string): Promise<boolean> => {
    const res = await window.electronAPI.invoke('settings:has-secret', { key }) as { present: boolean };
    return res.present;
  }, []);

  const setSecret = useCallback(async (key: string, value: string): Promise<void> => {
    await window.electronAPI.invoke('settings:set-secret', { key, value });
  }, []);

  const testSecret = useCallback(async (key: string, provider: ProviderName): Promise<{ valid: boolean; error?: string }> => {
    return window.electronAPI.invoke('settings:test-secret', { key, provider }) as Promise<{ valid: boolean; error?: string }>;
  }, []);

  const getPreference = useCallback(async (key: PreferenceKey): Promise<unknown> => {
    const res = await window.electronAPI.invoke('settings:get-preference', { key }) as { value: unknown };
    return res.value;
  }, []);

  const setPreference = useCallback(async (key: PreferenceKey, value: unknown): Promise<void> => {
    await window.electronAPI.invoke('settings:set-preference', { key, value });
  }, []);

  return { hasSecret, setSecret, testSecret, getPreference, setPreference };
}
