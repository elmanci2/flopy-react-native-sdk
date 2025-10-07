// src/Flopy.ts

import { stateRepository } from './services/StateRepository';
import { updateManager } from './services/UpdateManager';
import NativeBridge, { RNRestart } from './native/NativeBridge';
import { apiClient } from './services/ApiClient';
import { InstallMode, SyncStatus } from './types';
import type { FlopyOptions, PackageInfo, SyncOptions } from './types/sdk';

export { FlopyProvider } from './FlopyProvider';
export { SyncStatus };

class Flopy {
  static async _internalConfigure(
    developerOptions: FlopyOptions
  ): Promise<void> {
    const nativeConstants = NativeBridge.getConstants();

    const finalOptions: Required<FlopyOptions> = {
      serverUrl: developerOptions.serverUrl,
      appId: developerOptions.appId,
      channel: developerOptions.channel,
      deploymentKey: developerOptions.deploymentKey,
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

    apiClient.configure(finalOptions.serverUrl, finalOptions.deploymentKey);
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
      // PASO 1: Verifica si hay una actualización pendiente al inicio
      const pendingUpdate = stateRepository.getPendingUpdate();
      if (pendingUpdate) {
        console.log(
          `[Flopy] Se encontró una actualización pendiente: ${pendingUpdate.releaseId}`
        );

        // Verifica que el bundle exista antes de aplicar
        const bundleExists = await updateManager.verifyBundle(
          pendingUpdate.releaseId
        );
        if (!bundleExists) {
          console.log('[Flopy] ⚠️ Bundle pendiente no existe, limpiando...');
          await stateRepository.clearPendingUpdate();
          return SyncStatus.ERROR;
        }

        const mode = pendingUpdate.isMandatory
          ? mandatoryInstallMode
          : installMode;

        if (
          mode === InstallMode.IMMEDIATE ||
          mode === InstallMode.ON_NEXT_RESTART
        ) {
          console.log('[Flopy] Aplicando actualización pendiente...');

          await stateRepository.switchToVersion(pendingUpdate);
          await stateRepository.clearPendingUpdate();

          console.log('[Flopy] ✅ Estado guardado, esperando 100ms...');

          // Espera a que se persista el estado
          await new Promise((resolve: any) => setTimeout(resolve, 100));

          console.log('[Flopy] Reiniciando aplicación...');
          RNRestart.restart();
          return SyncStatus.UPDATE_INSTALLED;
        }
      }

      // PASO 2: Chequea si hay nuevas actualizaciones en el servidor
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
        `[Flopy] Actualización encontrada (releaseId: ${newPackage.releaseId}, mandatory: ${newPackage.isMandatory}).`
      );

      releaseId = response.package.releaseId;

      // PASO 3: Descarga la actualización
      const newPackageInfo = await updateManager.downloadAndApply(newPackage);

      // Verifica que el bundle se haya descargado correctamente
      const bundleExists = await updateManager.verifyBundle(
        newPackage.releaseId
      );
      if (!bundleExists) {
        console.error('[Flopy] ❌ Bundle no existe después de descargar');
        throw new Error('Bundle no encontrado después de la descarga');
      }

      const finalInstallMode = newPackage.isMandatory
        ? mandatoryInstallMode
        : installMode;

      // PASO 4: Aplica según el modo de instalación
      if (finalInstallMode === InstallMode.IMMEDIATE) {
        console.log(
          '[Flopy] Instalando actualización mandatory inmediatamente...'
        );

        await stateRepository.switchToVersion(newPackageInfo);

        console.log('[Flopy] ✅ Estado guardado, esperando 100ms...');

        // Espera a que se persista el estado
        await new Promise((resolve: any) => setTimeout(resolve, 100));

        console.log('[Flopy] Reiniciando aplicación...');
        RNRestart.restart();
        return SyncStatus.UPDATE_INSTALLED;
      } else {
        console.log(
          '[Flopy] Actualización descargada. Se instalará en el próximo reinicio.'
        );
        await stateRepository.recordPendingUpdate(
          newPackageInfo,
          newPackage.isMandatory
        );

        return SyncStatus.UPDATE_INSTALLED;
      }
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

      // Espera a que se persista
      await new Promise((resolve: any) => setTimeout(resolve, 100));

      RNRestart.restart();
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
