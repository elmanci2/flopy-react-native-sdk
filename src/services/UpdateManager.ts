// src/services/UpdateManager.ts
import { Platform } from 'react-native';
import type { UpdatePackage } from '../types/api';
import NativeBridge, { FlopyEventEmitter } from '../native/NativeBridge';
import type { PackageInfo } from '../types/sdk';
import { stateRepository } from './StateRepository';

/**
 * Nombre del bundle según la plataforma.
 * Android: index.android.bundle
 * iOS: main.jsbundle
 */
const BUNDLE_FILENAME =
  Platform.OS === 'ios' ? 'main.jsbundle' : 'index.android.bundle';

class UpdateManager {
  private flopyPath: string = '';
  private updatesPath: string = '';
  private pathsInitialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Inicializa las rutas de forma lazy y thread-safe.
   * Se llama automáticamente antes de cualquier operación de archivo.
   */
  private async ensurePaths(): Promise<void> {
    if (this.pathsInitialized) return;

    if (!this.initPromise) {
      this.initPromise = this._doInitPaths();
    }
    await this.initPromise;
  }

  private async _doInitPaths(): Promise<void> {
    try {
      const constants = NativeBridge.getConstants();
      this.flopyPath = constants.flopyPath;

      if (!this.flopyPath) {
        throw new Error(
          '[Flopy UM] flopyPath vacío, módulo nativo no inicializado'
        );
      }

      this.updatesPath = `${this.flopyPath}/updates`;
      await NativeBridge.mkdir(this.updatesPath);
      this.pathsInitialized = true;
      console.log('[Flopy UM] Updates path:', this.updatesPath);
    } catch (e) {
      this.initPromise = null; // Permite reintentar
      throw e;
    }
  }

  async downloadAndApply(updatePackage: UpdatePackage): Promise<PackageInfo> {
    await this.ensurePaths();

    const newPackagePath = `${this.updatesPath}/${updatePackage.releaseId}`;

    console.log('[Flopy UM] Verificando si existe:', newPackagePath);

    if (await NativeBridge.exists(newPackagePath)) {
      console.log('[Flopy UM] La actualización ya existe en el disco.');

      // Verifica que el bundle exista
      const bundlePath = `${newPackagePath}/${BUNDLE_FILENAME}`;
      const bundleExists = await NativeBridge.exists(bundlePath);
      console.log('[Flopy UM] Bundle exists?', bundleExists, bundlePath);

      if (!bundleExists) {
        console.log('[Flopy UM] Bundle no existe, re-descargando...');
        await NativeBridge.unlink(newPackagePath);
        await this.downloadFullPackage(updatePackage, newPackagePath);
      }
    } else {
      console.log('[Flopy UM] Descargando paquete completo...');
      await this.downloadFullPackage(updatePackage, newPackagePath);
    }

    const newPackageInfo: PackageInfo = {
      hash: updatePackage.hash,
      relativePath: `updates/${updatePackage.releaseId}/${BUNDLE_FILENAME}`,
      releaseId: updatePackage.releaseId,
    };

    console.log(
      '[Flopy UM] PackageInfo creado:',
      JSON.stringify(newPackageInfo)
    );

    return newPackageInfo;
  }

  private async downloadFile(
    fromUrl: string,
    toPath: string,
    expectedHash: string,
    releaseId: string
  ): Promise<void> {
    const tempPath = `${toPath}.tmp`;
    const downloadId = `download_${releaseId}`;

    // Registrar listeners ANTES de iniciar la descarga para evitar race conditions
    const progressSub = FlopyEventEmitter.addListener(
      'downloadProgress',
      (event) => {
        if (event.id === downloadId) {
          console.log(`[Flopy UM] Progreso ${event.progress}%`);
        }
      }
    );

    try {
      // H5: Validar HTTPS en producción para prevenir ataques MITM
      if (!__DEV__ && !fromUrl.toLowerCase().startsWith('https://')) {
        throw new Error(
          '[Flopy] SEGURIDAD: Solo se permiten descargas HTTPS en producción. URL: ' +
            fromUrl
        );
      }

      console.log('[Flopy UM] Descargando de:', fromUrl);
      console.log('[Flopy UM] Guardando en:', toPath);

      // El nativo ahora resuelve la promesa SOLO cuando la descarga termina
      await NativeBridge.downloadFile(fromUrl, tempPath, downloadId);
      console.log('[Flopy UM] Descarga completada');

      const actualHash = await NativeBridge.getSha256(tempPath);
      console.log('[Flopy UM] Hash esperado:', expectedHash);
      console.log('[Flopy UM] Hash recibido:', actualHash);

      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        throw new Error(
          `Error de integridad: el hash del paquete no coincide. Esperado: ${expectedHash}, Recibido: ${actualHash}`
        );
      }

      await NativeBridge.moveFile(tempPath, toPath);
      console.log('[Flopy UM] Archivo movido a destino final');
    } finally {
      // Siempre limpiar listeners y archivos temporales
      progressSub.remove();

      try {
        if (await NativeBridge.exists(tempPath)) {
          await NativeBridge.unlink(tempPath);
        }
      } catch (_e) {
        console.warn('[Flopy UM] No se pudo limpiar archivo temporal');
      }
    }
  }

  private async downloadFullPackage(
    updatePackage: UpdatePackage,
    newPackagePath: string
  ): Promise<void> {
    const zipPath = `${newPackagePath}.zip`;

    await this.downloadFile(
      updatePackage.bundleUrl,
      zipPath,
      updatePackage.hash,
      updatePackage.releaseId
    );

    console.log('[Flopy UM] Descomprimiendo:', zipPath, '→', newPackagePath);
    await NativeBridge.unzip(zipPath, newPackagePath);
    console.log('[Flopy UM] Descompresión completada');

    // Limpiar ZIP
    try {
      await NativeBridge.unlink(zipPath);
    } catch (_e) {
      console.warn('[Flopy UM] No se pudo eliminar el ZIP');
    }

    let bundleFilePath = `${newPackagePath}/${BUNDLE_FILENAME}`;
    let bundleExists = await NativeBridge.exists(bundleFilePath);

    // Fallback: el servidor podría enviar un nombre diferente al esperado
    // (ej: index.android.bundle en iOS o main.jsbundle en Android)
    if (!bundleExists) {
      const altName =
        Platform.OS === 'ios' ? 'index.android.bundle' : 'main.jsbundle';
      const altPath = `${newPackagePath}/${altName}`;
      if (await NativeBridge.exists(altPath)) {
        // Renombrar al nombre esperado por la plataforma
        await NativeBridge.moveFile(altPath, bundleFilePath);
        bundleExists = true;
        console.log(
          `[Flopy UM] Bundle renombrado de ${altName} a ${BUNDLE_FILENAME}`
        );
      }
    }

    console.log('[Flopy UM] Verificando bundle final:', bundleFilePath);
    console.log('[Flopy UM] Bundle existe?', bundleExists);

    if (!bundleExists) {
      // Limpiar directorio corrupto
      try {
        await NativeBridge.unlink(newPackagePath);
      } catch (_e) {}

      const dirContents = await NativeBridge.readDir(newPackagePath).catch(
        () => [] as string[]
      );
      console.log(
        '[Flopy UM] Contenido del paquete:',
        JSON.stringify(dirContents)
      );
      throw new Error('Bundle no encontrado después de descomprimir');
    }

    console.log('[Flopy UM] ✅ Bundle descargado y verificado correctamente');
  }

  async cleanupOldUpdates(): Promise<void> {
    await this.ensurePaths();

    const state = stateRepository.getState();
    const activeReleases = [
      state.currentPackage?.releaseId,
      state.previousPackage?.releaseId,
      state.pendingUpdate?.releaseId, // G4: proteger pendingUpdate
    ].filter(Boolean) as string[];

    console.log('[Flopy UM] Limpiando updates. Activos:', activeReleases);

    try {
      const updateDirs = await NativeBridge.readDir(this.updatesPath);

      for (const dirName of updateDirs) {
        if (!activeReleases.includes(dirName)) {
          console.log('[Flopy UM] Eliminando update antiguo:', dirName);
          await NativeBridge.unlink(`${this.updatesPath}/${dirName}`);
        }
      }

      console.log('[Flopy UM] Limpieza completada');
    } catch (e) {
      console.error('[Flopy UM] Error durante limpieza:', e);
    }
  }

  async verifyBundle(releaseId: string): Promise<boolean> {
    await this.ensurePaths();

    const bundlePath = `${this.updatesPath}/${releaseId}/${BUNDLE_FILENAME}`;
    try {
      const exists = await NativeBridge.exists(bundlePath);
      console.log('[Flopy UM] verifyBundle:', releaseId, '→', exists);
      return exists;
    } catch (e) {
      console.error('[Flopy UM] Error verificando bundle:', e);
      return false;
    }
  }
}

export const updateManager = new UpdateManager();
