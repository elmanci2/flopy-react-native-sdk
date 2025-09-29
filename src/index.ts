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
    // 1. Autodetecta valores desde el puente nativo.
    const nativeConstants = NativeBridge.getConstants();

    // 2. Fusiona las opciones del desarrollador con las autodetectadas.
    const finalOptions: Required<FlopyOptions> = {
      serverUrl: developerOptions.serverUrl,
      appId: developerOptions.appId,
      channel: developerOptions.channel,
      binaryVersion:
        developerOptions.binaryVersion || nativeConstants.binaryVersion,
      clientUniqueId:
        developerOptions.clientUniqueId || nativeConstants.clientUniqueId,
    };

    // 3. Valida que las opciones requeridas estén presentes.
    if (
      !finalOptions.serverUrl ||
      !finalOptions.appId ||
      !finalOptions.channel
    ) {
      throw new Error(
        'Faltan opciones requeridas en la configuración de Flopy: serverUrl, appId, o channel.'
      );
    }

    // 4. Configura los servicios dependientes con las opciones FINALES.
    apiClient.configure(finalOptions.serverUrl);
    await stateRepository.initialize(finalOptions);

    console.log('[Flopy] SDK configurado e inicializado con éxito.');
  }

  static async sync(options: SyncOptions = {}): Promise<SyncStatus> {
    const {
      installMode = InstallMode.ON_NEXT_RESTART,
      mandatoryInstallMode = InstallMode.IMMEDIATE,
    } = options;

    // `releaseId` se define aquí para que esté disponible en el bloque catch.
    let releaseId: string | undefined = undefined;

    try {
      // 1. Instala cualquier actualización que esté pendiente desde la última sincronización.
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
          return SyncStatus.UPDATE_INSTALLED; // Teóricamente no se alcanza por el reinicio.
        }
      }

      // 2. Comprueba si hay una nueva actualización en el servidor.
      const stateOptions = stateRepository.getOptions();
      const currentPackage = stateRepository.getCurrentPackage();
      const response = await apiClient.checkForUpdate(
        stateOptions,
        currentPackage?.hash
      );

      if (!response.updateAvailable || !response.package) {
        // Aprovecha para limpiar archivos viejos si no hay nada que hacer.
        await updateManager.cleanupOldUpdates();
        console.log('[Flopy] La aplicación está actualizada.');
        return SyncStatus.UP_TO_DATE;
      }

      // Guardamos el releaseId en cuanto lo sabemos.
      releaseId = response.package.releaseId;
      const newPackage = response.package;
      console.log(
        `[Flopy] Actualización encontrada (releaseId: ${releaseId}). Procediendo a la descarga.`
      );

      // 3. Descarga la actualización (completa o parche).
      const newPackageInfo = await updateManager.downloadAndApply(
        newPackage,
        response.patch
      );

      // 4. Decide cómo instalar según el modo.
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
