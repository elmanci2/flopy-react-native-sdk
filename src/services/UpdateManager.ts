// src/services/UpdateManager.ts
import RNFS from 'react-native-fs';
import type { UpdatePackage } from '../types/api';
import NativeBridge from '../native/NativeBridge';
import type { PackageInfo } from '../types/sdk';
import { hash } from 'react-native-fs';
import { stateRepository } from './StateRepository';

class UpdateManager {
  private flopyPath: string = '';
  private updatesPath: string = '';

  constructor() {
    this.initializePaths();
  }

  private async initializePaths(): Promise<void> {
    const constants = NativeBridge.getConstants();
    this.flopyPath = constants.flopyPath;
    this.updatesPath = `${this.flopyPath}/updates`;
    await RNFS.mkdir(this.updatesPath);
    console.log('[Flopy UM] Updates path:', this.updatesPath);
  }

  async downloadAndApply(updatePackage: UpdatePackage): Promise<PackageInfo> {
    const newPackagePath = `${this.updatesPath}/${updatePackage.releaseId}`;

    console.log('[Flopy UM] Verificando si existe:', newPackagePath);

    if (await RNFS.exists(newPackagePath)) {
      console.log('[Flopy UM] La actualización ya existe en el disco.');

      // Verifica que el bundle exista
      const bundlePath = `${newPackagePath}/index.android.bundle`;
      const bundleExists = await RNFS.exists(bundlePath);
      console.log('[Flopy UM] Bundle exists?', bundleExists, bundlePath);

      if (!bundleExists) {
        console.log('[Flopy UM] Bundle no existe, re-descargando...');
        await RNFS.unlink(newPackagePath);
        await this.downloadFullPackage(updatePackage, newPackagePath);
      }
    } else {
      console.log('[Flopy UM] Descargando paquete completo...');
      await this.downloadFullPackage(updatePackage, newPackagePath);
    }

    const newPackageInfo: PackageInfo = {
      hash: updatePackage.hash,
      relativePath: `updates/${updatePackage.releaseId}/index.android.bundle`,
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
    expectedHash: string
  ): Promise<void> {
    const tempPath = `${toPath}.tmp`;

    try {
      console.log('[Flopy UM] Descargando de:', fromUrl);
      console.log('[Flopy UM] Guardando en:', toPath);

      const { promise } = RNFS.downloadFile({
        fromUrl,
        toFile: tempPath,
        background: true,
      });

      await promise;
      console.log('[Flopy UM] Descarga completada');

      const actualHash = await hash(tempPath, 'sha256');
      console.log('[Flopy UM] Hash esperado:', expectedHash);
      console.log('[Flopy UM] Hash recibido:', actualHash);

      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        throw new Error(
          `Error de integridad: el hash del paquete no coincide. Esperado: ${expectedHash}, Recibido: ${actualHash}`
        );
      }

      await RNFS.moveFile(tempPath, toPath);
      console.log('[Flopy UM] Archivo movido a destino final');
    } finally {
      if (await RNFS.exists(tempPath)) {
        await RNFS.unlink(tempPath);
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
      updatePackage.hash
    );

    console.log('[Flopy UM] Descomprimiendo:', zipPath, '→', newPackagePath);
    await NativeBridge.unzip(zipPath, newPackagePath);
    console.log('[Flopy UM] Descompresión completada');

    await RNFS.unlink(zipPath);

    const bundleFilePath = `${newPackagePath}/index.android.bundle`;
    const bundleExists = await RNFS.exists(bundleFilePath);

    console.log('[Flopy UM] Verificando bundle final:', bundleFilePath);
    console.log('[Flopy UM] Bundle existe?', bundleExists);

    if (!bundleExists) {
      const dirContents = await RNFS.readDir(newPackagePath);
      console.log(
        '[Flopy UM] Contenido del paquete:',
        JSON.stringify(dirContents.map((item) => item.name))
      );
      throw new Error('Bundle no encontrado después de descomprimir');
    }

    console.log('[Flopy UM] ✅ Bundle descargado y verificado correctamente');
  }

  async cleanupOldUpdates(): Promise<void> {
    const state = stateRepository.getState();
    const activeReleases = [
      state.currentPackage?.releaseId,
      state.previousPackage?.releaseId,
    ].filter(Boolean) as string[];

    console.log('[Flopy UM] Limpiando updates. Activos:', activeReleases);

    try {
      const updateDirs = await RNFS.readDir(this.updatesPath);

      for (const dir of updateDirs) {
        if (dir.isDirectory() && !activeReleases.includes(dir.name)) {
          console.log('[Flopy UM] Eliminando update antiguo:', dir.name);
          await RNFS.unlink(dir.path);
        }
      }

      console.log('[Flopy UM] Limpieza completada');
    } catch (e) {
      console.error('[Flopy UM] Error durante limpieza:', e);
    }
  }

  async verifyBundle(releaseId: string): Promise<boolean> {
    const bundlePath = `${this.updatesPath}/${releaseId}/index.android.bundle`;
    const exists = await RNFS.exists(bundlePath);
    console.log('[Flopy UM] verifyBundle:', releaseId, '→', exists);
    return exists;
  }
}

export const updateManager = new UpdateManager();
