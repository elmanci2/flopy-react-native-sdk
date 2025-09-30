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
  }

  async downloadAndApply(updatePackage: UpdatePackage): Promise<PackageInfo> {
    // Usa releaseId como nombre de carpeta (como pushy usa el hash/version)
    const newPackagePath = `${this.updatesPath}/${updatePackage.releaseId}`;

    if (await RNFS.exists(newPackagePath)) {
      console.log('[Flopy] La actualización ya existe en el disco.');
    } else {
      console.log('[Flopy] Descargando paquete completo...');
      await this.downloadFullPackage(updatePackage, newPackagePath);
    }

    const newPackageInfo: PackageInfo = {
      hash: updatePackage.hash,
      // ⚠️ CAMBIO: Usa releaseId en el path (no hash)
      relativePath: `updates/${updatePackage.releaseId}/index.android.bundle`,
      releaseId: updatePackage.releaseId,
    };

    return newPackageInfo;
  }

  private async downloadFile(
    fromUrl: string,
    toPath: string,
    expectedHash: string
  ): Promise<void> {
    const tempPath = `${toPath}.tmp`;

    try {
      const { promise } = RNFS.downloadFile({
        fromUrl,
        toFile: tempPath,
        background: true,
      });

      await promise;

      const actualHash = await hash(tempPath, 'sha256');

      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        throw new Error(
          `Error de integridad: el hash del paquete no coincide. Esperado: ${expectedHash}, Recibido: ${actualHash}`
        );
      }

      await RNFS.moveFile(tempPath, toPath);
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

    await NativeBridge.unzip(zipPath, newPackagePath);
    await RNFS.unlink(zipPath);

    const bundleFilePath = `${newPackagePath}/index.android.bundle`;
    const bundleExists = await RNFS.exists(bundleFilePath);

    if (!bundleExists) {
      const dirContents = await RNFS.readDir(newPackagePath);
      console.log(
        '[Flopy] Contenido del paquete:',
        JSON.stringify(dirContents.map((item) => item.name))
      );
      throw new Error('Bundle no encontrado después de descomprimir');
    }

    console.log('[Flopy] Bundle descargado y verificado correctamente');
  }

  async cleanupOldUpdates(): Promise<void> {
    const state = stateRepository.getState();

    // ⚠️ CAMBIO: Usa releaseId en lugar de hash
    const activeReleases = [
      state.currentPackage?.releaseId,
      state.previousPackage?.releaseId,
    ].filter(Boolean) as string[];

    console.log('[Flopy] Limpiando updates. Activos:', activeReleases);

    try {
      const updateDirs = await RNFS.readDir(this.updatesPath);

      for (const dir of updateDirs) {
        if (dir.isDirectory() && !activeReleases.includes(dir.name)) {
          console.log('[Flopy] Eliminando update antiguo:', dir.name);
          await RNFS.unlink(dir.path);
        }
      }

      console.log('[Flopy] Limpieza completada');
    } catch (e) {
      console.error('[Flopy] Error durante limpieza:', e);
    }
  }

  // NUEVO: Verifica si un bundle existe
  async verifyBundle(releaseId: string): Promise<boolean> {
    const bundlePath = `${this.updatesPath}/${releaseId}/index.android.bundle`;
    return await RNFS.exists(bundlePath);
  }
}

export const updateManager = new UpdateManager();
