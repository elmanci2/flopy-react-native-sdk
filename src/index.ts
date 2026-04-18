// src/Flopy.ts

import { stateRepository } from './services/StateRepository';
import { updateManager } from './services/UpdateManager';
import NativeBridge, {
  RNRestart,
  FlopyEventEmitter,
} from './native/NativeBridge';
import { apiClient } from './services/ApiClient';
import { InstallMode, SyncStatus } from './types';
import type { FlopyOptions, PackageInfo, SyncOptions } from './types/sdk';

export { FlopyProvider, flopy } from './FlopyProvider';
import { flopy as flopyHOC } from './FlopyProvider';
export { SyncStatus };

class Flopy {
  private static isSyncing: boolean = false;
  static async _internalConfigure(
    developerOptions: FlopyOptions
  ): Promise<void> {
    const nativeConstants = NativeBridge.getConstants();
    const forceJs = developerOptions.forceJsConfig === true;

    const finalOptions: Required<FlopyOptions> = {
      serverUrl:
        (forceJs
          ? developerOptions.serverUrl
          : nativeConstants.serverUrl || developerOptions.serverUrl) || '',
      appId:
        (forceJs
          ? developerOptions.appId
          : nativeConstants.appId || developerOptions.appId) || '',
      channel:
        (forceJs
          ? developerOptions.channel
          : nativeConstants.channel || developerOptions.channel) ||
        'production',
      deploymentKey:
        (forceJs
          ? developerOptions.deploymentKey
          : nativeConstants.deploymentKey || developerOptions.deploymentKey) ||
        '',
      binaryVersion:
        developerOptions.binaryVersion || nativeConstants.binaryVersion,
      clientUniqueId:
        developerOptions.clientUniqueId || nativeConstants.clientUniqueId,
      forceJsConfig: forceJs,
    };

    if (!finalOptions.serverUrl) {
      throw new Error(
        'Faltan opciones requeridas en la configuración de Flopy: serverUrl.'
      );
    }

    if (!finalOptions.deploymentKey && (!finalOptions.appId || !finalOptions.channel)) {
      throw new Error(
        'Faltan opciones requeridas en la configuración de Flopy: debes proveer un deploymentKey, o en su defecto appId y channel.'
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

    if (Flopy.isSyncing) {
      console.log('[Flopy] Sync ya en progreso, ignorando llamada duplicada.');
      return SyncStatus.CHECKING_FOR_UPDATE;
    }
    Flopy.isSyncing = true;

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
          await new Promise<void>((resolve) => setTimeout(resolve, 100));

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
        await new Promise<void>((resolve) => setTimeout(resolve, 100));

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
    } finally {
      Flopy.isSyncing = false;
    }
  }

  static async rollback(): Promise<void> {
    const previousPackage = stateRepository.getPreviousPackage();
    if (previousPackage) {
      console.log('[Flopy] Revirtiendo a la versión anterior...');
      await stateRepository.revertToPreviousPackage();

      // Espera a que se persista
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      RNRestart.restart();
    } else {
      console.log('[Flopy] No hay una versión anterior a la que revertir.');
    }
  }

  static async getUpdateMetadata(): Promise<PackageInfo | undefined> {
    return stateRepository.getCurrentPackage();
  }

  /**
   * Permite escuchar eventos del SDK (ej: downloadProgress, downloadFinished)
   */
  static addListener(event: string, callback: (data: any) => void) {
    return FlopyEventEmitter.addListener(event, callback);
  }

  /**
   * HOC estilo CodePush para envolver la app con Flopy.
   *
   * @example
   * import Flopy from 'flopy-react-native-sdk';
   * MyApp = Flopy.wrap({ serverUrl: '...', appId: '...' })(MyApp);
   */
  static wrap = flopyHOC;
}

export * from './types';

export default Flopy;
