// src/Flopy.ts

import { stateRepository } from './services/StateRepository';

import { updateManager } from './services/UpdateManager';
import NativeBridge from './native/NativeBridge';
import { apiClient } from './services/ApiClient';
import { InstallMode, SyncStatus } from './types';
import type { FlopyOptions, PackageInfo, SyncOptions } from './types/sdk';

export { FlopyProvider } from './FlopyProvider';
export { SyncStatus };

class Flopy {
  /**
   * @internal - Orquesta toda la configuración del SDK. Solo debe ser llamado por el FlopyProvider.
   */
  static async _internalConfigure(
    developerOptions: FlopyOptions
  ): Promise<void> {
    const nativeConstants = NativeBridge.getConstants();

    const finalOptions: Required<FlopyOptions> = {
      serverUrl: developerOptions.serverUrl,
      appId: developerOptions.appId,
      channel: developerOptions.channel,
      binaryVersion:
        developerOptions.binaryVersion || nativeConstants.binaryVersion,
      clientUniqueId:
        developerOptions.clientUniqueId || nativeConstants.clientUniqueId,
    };

    if (
      !finalOptions.serverUrl ||
      !finalOptions.appId ||
      !finalOptions.channel
    ) {
      throw new Error(
        'Faltan opciones requeridas en la configuración de Flopy: serverUrl, appId, o channel.'
      );
    }

    apiClient.configure(finalOptions.serverUrl);
    await stateRepository.initialize(finalOptions);

    console.log('[Flopy] SDK configurado e inicializado con éxito.');
  }

  static async sync(options: SyncOptions = {}): Promise<SyncStatus> {
    const {
      installMode = InstallMode.ON_NEXT_RESTART,
      mandatoryInstallMode = InstallMode.IMMEDIATE,
    } = options;

    let releaseId: string | null = null;

    try {
      const pendingUpdate = stateRepository.getPendingUpdate();
      if (pendingUpdate) {
        console.log(
          `[Flopy] Se encontró una actualización pendiente: ${pendingUpdate.hash}`
        );
        const mode = pendingUpdate.isMandatory
          ? mandatoryInstallMode
          : installMode;

        if (
          mode === InstallMode.IMMEDIATE ||
          mode === InstallMode.ON_NEXT_RESTART
        ) {
          console.log(
            '[Flopy] Aplicando actualización pendiente y reiniciando...'
          );

          await stateRepository.recordNewPackage(pendingUpdate);

          await stateRepository.clearPendingUpdate();

          NativeBridge.restartApp();
          return SyncStatus.UPDATE_INSTALLED;
        }
      }
      const stateOptions = stateRepository.getOptions();
      const currentPackage = stateRepository.getCurrentPackage();
      const response = await apiClient.checkForUpdate(
        stateOptions,
        currentPackage?.hash
      );

      if (!response.updateAvailable || !response.package) {
        await updateManager.cleanupOldUpdates();
        console.log('[Flopy] La aplicación está actualizada.');
        return SyncStatus.UP_TO_DATE;
      }

      const newPackage = response.package;
      console.log(
        `[Flopy] Actualización encontrada (releaseId: ${newPackage.releaseId}).`
      );

      releaseId = response.package.releaseId;

      const newPackageInfo = await updateManager.downloadAndApply(
        newPackage,
        response.patch
      );

      const finalInstallMode = newPackage.isMandatory
        ? mandatoryInstallMode
        : installMode;

      if (finalInstallMode === InstallMode.IMMEDIATE) {
        console.log('[Flopy] Instalando actualización inmediatamente...');
        await stateRepository.recordNewPackage(newPackageInfo);

        const finalState = stateRepository.getState();
        console.log(
          '[Flopy JS DEBUG] Estado final antes del reinicio:',
          JSON.stringify(finalState, null, 2)
        );
        // ------------------------------------

        NativeBridge.restartApp();
      } else {
        console.log(
          '[Flopy] Actualización descargada. Se instalará en el próximo reinicio.'
        );
        await stateRepository.recordPendingUpdate(
          newPackageInfo,
          newPackage.isMandatory
        );

        const finalState = stateRepository.getState();
        console.log(
          '[Flopy JS DEBUG] Estado final (pendiente) antes de salir:',
          JSON.stringify(finalState, null, 2)
        );
      }

      return SyncStatus.UPDATE_INSTALLED;
    } catch (error: any) {
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

export * from './types';

export default Flopy;
