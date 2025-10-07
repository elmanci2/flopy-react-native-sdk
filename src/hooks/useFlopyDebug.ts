// src/hooks/useFlopyDebug.ts
import { useEffect, useState } from 'react';
import FlopyDebugHelper from '../utils/DebugHelper';
import Flopy from '../index';
import { RNRestart } from '../native/NativeBridge';

export function useFlopyDebug() {
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = async () => {
    setIsLoading(true);
    try {
      const info = await FlopyDebugHelper.getDebugInfo();
      setDebugInfo(info);
    } catch (e) {
      console.error('[useFlopyDebug] Error:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const verifyBundle = async (releaseId: string) => {
    return await FlopyDebugHelper.verifyBundle(releaseId);
  };

  const listContents = async (releaseId: string) => {
    return await FlopyDebugHelper.listUpdateContents(releaseId);
  };

  const resetEverything = async () => {
    await FlopyDebugHelper.resetEverything();
  };

  const forceApplyPending = async () => {
    await FlopyDebugHelper.forceApplyPending();
  };

  const syncAndRestart = async () => {
    console.log('[Debug] Ejecutando sync...');
    await Flopy.sync({ installMode: 1 });
  };

  const manualRestart = () => {
    console.log('[Debug] Reiniciando manualmente...');
    RNRestart.restart();
  };

  useEffect(() => {
    refresh();
  }, []);

  return {
    debugInfo,
    isLoading,
    refresh,
    verifyBundle,
    listContents,
    resetEverything,
    forceApplyPending,
    syncAndRestart,
    manualRestart,
  };
}
