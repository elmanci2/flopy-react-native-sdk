// src/services/UpdateManager.ts

import RNFS from 'react-native-fs';

import type { UpdatePackage, UpdatePatch } from '../types/api';
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

  async downloadAndApply(
    updatePackage: UpdatePackage,
    patch?: UpdatePatch
  ): Promise<PackageInfo> {
    const newPackagePath = `${this.updatesPath}/${updatePackage.hash}`;

    if (await RNFS.exists(newPackagePath)) {
    } else {
      if (patch) {
        await this.applyPatch(patch, newPackagePath);
      } else {
        await this.downloadFullPackage(updatePackage, newPackagePath);
      }
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

  private async applyPatch(
    patch: UpdatePatch,
    newPackagePath: string
  ): Promise<void> {
    const currentPackage = stateRepository.getCurrentPackage();
    if (!currentPackage) {
      throw new Error('No se puede aplicar un parche sin un paquete actual.');
    }

    const patchZipPath = `${this.updatesPath}/patch.zip`;
    const patchTempDir = `${this.updatesPath}/patch_temp`;
    const currentPackageDir = `${this.flopyPath}/updates/${currentPackage.hash}`;

    await this.downloadFile(patch.url, patchZipPath, patch.hash);
    await NativeBridge.unzip(patchZipPath, patchTempDir);
    await RNFS.unlink(patchZipPath);

    try {
      const manifestPath = `${patchTempDir}/manifest.json`;
      if (!(await RNFS.exists(manifestPath))) {
        throw new Error(
          'El manifiesto del parche (manifest.json) no fue encontrado.'
        );
      }
      const manifest = JSON.parse(await RNFS.readFile(manifestPath, 'utf8'));

      await RNFS.mkdir(newPackagePath);
      const itemsInCurrentPackage = await RNFS.readDir(currentPackageDir);
      for (const item of itemsInCurrentPackage) {
        const destPath = `${newPackagePath}/${item.name}`;
        await RNFS.copyFile(item.path, destPath);
      }

      for (const fileToDelete of manifest.deletedFiles) {
        const fullPath = `${newPackagePath}/${fileToDelete}`;
        if (await RNFS.exists(fullPath)) {
          await RNFS.unlink(fullPath);
        }
      }

      for (const fileToAdd of manifest.newFiles) {
        const sourcePath = `${patchTempDir}/${fileToAdd}`;
        const destPath = `${newPackagePath}/${fileToAdd}`;

        await RNFS.mkdir(destPath.substring(0, destPath.lastIndexOf('/')), {
          NSURLIsExcludedFromBackupKey: true,
        });
        await RNFS.copyFile(sourcePath, destPath);
      }

      for (const relativePath in manifest.patchedFiles) {
        const patchContent = manifest.patchedFiles[relativePath];
        const originalFilePath = `${newPackagePath}/${relativePath}`;

        await NativeBridge.applyPatch(originalFilePath, patchContent);
      }
    } finally {
      if (await RNFS.exists(patchTempDir)) {
        await RNFS.unlink(patchTempDir);
      }
    }
  }
}

export const updateManager = new UpdateManager();
