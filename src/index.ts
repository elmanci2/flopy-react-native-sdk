// src/Flopy.ts

import { stateRepository } from './services/StateRepository';

import { updateManager } from './services/UpdateManager';
import NativeBridge from './native/NativeBridge';
import { apiClient } from './services/ApiClient';
import { InstallMode, SyncStatus } from './types';
import type { FlopyOptions } from './types';
import type { PackageInfo, SyncOptions } from './types/sdk';

export { FlopyProvider } from './FlopyProvider';
export { SyncStatus };

class Flopy {
  static async configure(options: FlopyOptions): Promise<void> {
    await stateRepository.initialize(options);
    apiClient.configure(options.serverUrl);
  }

  static async sync(options: SyncOptions = {}): Promise<SyncStatus> {
    const {
      installMode = InstallMode.ON_NEXT_RESTART,
      mandatoryInstallMode = InstallMode.IMMEDIATE,
    } = options;

    let releaseId: string | null = null;

    try {
      // 1. Instala cualquier actualización que esté pendiente desde la última sincronización
      const pendingUpdate = stateRepository.getPendingUpdate();
      if (pendingUpdate) {
        const mode = pendingUpdate.isMandatory
          ? mandatoryInstallMode
          : installMode;
        if (mode === InstallMode.IMMEDIATE) {
          console.log(
            '[Flopy] Instalando actualización pendiente inmediatamente...'
          );
          await stateRepository.recordNewPackage(pendingUpdate);
          await stateRepository.clearPendingUpdate();
          NativeBridge.restartApp();
          return SyncStatus.UPDATE_INSTALLED; // Teóricamente no se alcanza por el reinicio
        }
      }

      // 2. Comprueba si hay una nueva actualización en el servidor
      const stateOptions = stateRepository.getOptions();
      const currentPackage = stateRepository.getCurrentPackage();
      const response = await apiClient.checkForUpdate(
        stateOptions,
        currentPackage?.hash
      );

      if (!response.updateAvailable || !response.package) {
        // Aprovecha para limpiar archivos viejos si no hay nada que hacer
        await updateManager.cleanupOldUpdates();
        return SyncStatus.UP_TO_DATE;
      }

      const newPackage = response.package;

      // 3. Descarga la actualización (completa o parche)
      const newPackageInfo = await updateManager.downloadAndApply(
        newPackage,
        response.patch
      );

      // 4. Decide cómo instalar según el modo
      const finalInstallMode = newPackage.isMandatory
        ? mandatoryInstallMode
        : installMode;

      if (finalInstallMode === InstallMode.IMMEDIATE) {
        console.log('[Flopy] Instalando actualización inmediatamente...');
        await stateRepository.recordNewPackage(newPackageInfo);
        NativeBridge.restartApp();
      } else {
        console.log(
          '[Flopy] Actualización descargada. Se instalará en el próximo reinicio.'
        );
        await stateRepository.recordPendingUpdate(
          newPackageInfo,
          newPackage.isMandatory
        );
      }

      releaseId = response.package.releaseId;

      return SyncStatus.UPDATE_INSTALLED;
    } catch (error) {
      console.error('[Flopy] Error durante sync:', error);
      if (releaseId) {
        const stateOptions = stateRepository.getOptions();
        await apiClient.reportStatus(stateOptions, releaseId, 'FAILURE');
        console.log(
          `[Flopy] Fallo reportado al servidor para la release: ${releaseId}`
        );
      }
      return SyncStatus.ERROR;
    }
  }

  static async rollback(): Promise<void> {
    const previousPackage = stateRepository.getPreviousPackage();
    if (previousPackage) {
      console.log('[Flopy] Revirtiendo a la versión anterior...');
      await stateRepository.revertToPreviousPackage();
      NativeBridge.restartApp();
    } else {
      console.log('[Flopy] No hay una versión anterior a la que revertir.');
    }
  }

  static async getUpdateMetadata(): Promise<PackageInfo | undefined> {
    return stateRepository.getCurrentPackage();
  }
}

export default Flopy;
