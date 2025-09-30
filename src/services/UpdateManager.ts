// src/services/UpdateManager.ts

import RNFS from 'react-native-fs';

import type { UpdatePackage } from '../types/api';
import { stateRepository } from './StateRepository';
import NativeBridge from '../native/NativeBridge';
import type { PackageInfo } from '../types/sdk';
import { hash } from 'react-native-fs';

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
    const newPackagePath = `${this.updatesPath}/${updatePackage.hash}`;

    if (await RNFS.exists(newPackagePath)) {
      console.log('[Flopy] La actualización ya existe en el disco.');
    } else {
      console.log('[Flopy] Descargando paquete completo...');
      await this.downloadFullPackage(updatePackage, newPackagePath);
    }
    const newPackageInfo: PackageInfo = {
      hash: updatePackage.hash,
      relativePath: `updates/${updatePackage.hash}/index.android.bundle`,
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
      console.log(JSON.stringify(dirContents.map((item) => item.name)));
    }
  }

  async cleanupOldUpdates(): Promise<void> {
    const state = stateRepository.getState();
    const activeHashes = [
      state.currentPackage?.hash,
      state.previousPackage?.hash,
    ].filter(Boolean);

    const updateDirs = await RNFS.readDir(this.updatesPath);
    for (const dir of updateDirs) {
      if (dir.isDirectory() && !activeHashes.includes(dir.name)) {
        await RNFS.unlink(dir.path);
      }
    }
  }
}

export const updateManager = new UpdateManager();
