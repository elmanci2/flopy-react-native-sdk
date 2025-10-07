// src/utils/DebugHelper.ts
import RNFS from 'react-native-fs';
import NativeBridge from '../native/NativeBridge';
import { stateRepository } from '../services/StateRepository';

export class FlopyDebugHelper {
  /**
   * Muestra información completa del estado actual
   */
  static async getDebugInfo(): Promise<any> {
    const constants = NativeBridge.getConstants();
    const flopyPath = constants.flopyPath;
    const updatesPath = `${flopyPath}/updates`;

    // Lee el estado desde nativo
    const nativeState = await NativeBridge.readState();

    // Lee el estado desde JS
    const jsState = stateRepository.getState();

    // Lista todos los bundles en disco
    let bundlesOnDisk: string[] = [];
    try {
      const exists = await RNFS.exists(updatesPath);
      if (exists) {
        const dirs = await RNFS.readDir(updatesPath);
        bundlesOnDisk = dirs.filter((d) => d.isDirectory()).map((d) => d.name);
      }
    } catch (e) {
      console.error('[Debug] Error al leer updates:', e);
    }

    // Verifica cada bundle
    const bundleVerifications: Record<string, boolean> = {};
    for (const releaseId of bundlesOnDisk) {
      const bundlePath = `${updatesPath}/${releaseId}/index.android.bundle`;
      bundleVerifications[releaseId] = await RNFS.exists(bundlePath);
    }

    const debugInfo = {
      timestamp: new Date().toISOString(),
      constants: {
        flopyPath,
        binaryVersion: constants.binaryVersion,
        clientUniqueId: constants.clientUniqueId,
      },
      nativeState,
      jsState,
      bundlesOnDisk,
      bundleVerifications,
    };

    console.log('═══════════════════════════════════════════════════');
    console.log('🔍 FLOPY DEBUG INFO');
    console.log('═══════════════════════════════════════════════════');
    console.log(JSON.stringify(debugInfo, null, 2));
    console.log('═══════════════════════════════════════════════════');

    return debugInfo;
  }

  /**
   * Verifica si un bundle específico existe y es válido
   */
  static async verifyBundle(releaseId: string): Promise<{
    exists: boolean;
    path: string;
    size?: number;
  }> {
    const constants = NativeBridge.getConstants();
    const bundlePath = `${constants.flopyPath}/updates/${releaseId}/index.android.bundle`;

    const exists = await RNFS.exists(bundlePath);
    let size: number | undefined;

    if (exists) {
      try {
        const stat: any = await RNFS.stat(bundlePath);
        size = parseInt(stat.size);
      } catch (e) {
        console.error('[Debug] Error al obtener tamaño:', e);
      }
    }

    const result = { exists, path: bundlePath, size };
    console.log('[Debug] verifyBundle:', JSON.stringify(result));
    return result;
  }

  /**
   * Lista todos los archivos en el directorio de una actualización
   */
  static async listUpdateContents(releaseId: string): Promise<string[]> {
    const constants = NativeBridge.getConstants();
    const updatePath = `${constants.flopyPath}/updates/${releaseId}`;

    try {
      const exists = await RNFS.exists(updatePath);
      if (!exists) {
        console.log('[Debug] Update directory does not exist:', updatePath);
        return [];
      }

      const contents = await RNFS.readDir(updatePath);
      const files = contents.map((item) => ({
        name: item.name,
        isDirectory: item.isDirectory(),
        size: item.size,
      }));

      console.log(
        '[Debug] Contents of',
        releaseId,
        ':',
        JSON.stringify(files, null, 2)
      );
      return files.map((f) => f.name);
    } catch (e) {
      console.error('[Debug] Error listing contents:', e);
      return [];
    }
  }

  /**
   * Limpia todo el estado (útil para testing)
   */
  static async resetEverything(): Promise<void> {
    console.log('[Debug] ⚠️ Reseteando todo el estado de Flopy...');

    // Limpia el estado en nativo
    await NativeBridge.saveState({
      currentPackage: undefined,
      previousPackage: undefined,
      pendingUpdate: undefined,
      failedBootCount: 0,
    });

    // Elimina todos los bundles
    const constants = NativeBridge.getConstants();
    const updatesPath = `${constants.flopyPath}/updates`;

    try {
      const exists = await RNFS.exists(updatesPath);
      if (exists) {
        await RNFS.unlink(updatesPath);
        console.log('[Debug] ✅ Updates eliminados');
      }
    } catch (e) {
      console.error('[Debug] Error al eliminar updates:', e);
    }

    console.log(
      '[Debug] ✅ Estado reseteado. Reinicia la app para usar el bundle nativo.'
    );
  }

  /**
   * Fuerza la aplicación de una actualización pendiente
   */
  static async forceApplyPending(): Promise<void> {
    const state = stateRepository.getState();

    if (!state.pendingUpdate) {
      console.log('[Debug] No hay actualización pendiente');
      return;
    }

    console.log(
      '[Debug] Forzando aplicación de:',
      state.pendingUpdate.releaseId
    );

    await stateRepository.switchToVersion(state.pendingUpdate);
    await stateRepository.clearPendingUpdate();

    console.log('[Debug] ✅ Actualización aplicada, reinicia manualmente');
  }
}

// Exporta para uso en DevMenu o durante desarrollo
export default FlopyDebugHelper;
