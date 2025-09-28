// src/services/UpdateManager.ts

import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
//@ts-ignore
import * as jsdiff from 'diff';
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

  /**
   * Orquesta todo el proceso de descarga y aplicación de una actualización.
   */
  async downloadAndApply(
    updatePackage: UpdatePackage,
    patch?: UpdatePatch
  ): Promise<PackageInfo> {
    const newPackagePath = `${this.updatesPath}/${updatePackage.hash}`;

    if (await RNFS.exists(newPackagePath)) {
      console.log(
        '[Flopy] La actualización ya existe en el disco, saltando descarga.'
      );
    } else {
      if (patch) {
        console.log('[Flopy] Aplicando parche diferencial...');
        await this.applyPatch(patch, newPackagePath);
      } else {
        console.log('[Flopy] Descargando paquete completo...');
        await this.downloadFullPackage(updatePackage, newPackagePath);
      }
    }

    const newPackageInfo: PackageInfo = {
      hash: updatePackage.hash,
      relativePath: `updates/${updatePackage.hash}/index.android.bundle`,
      releaseId: updatePackage.releaseId, // <-- Añade esta línea
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

      // --- ¡LÓGICA IMPLEMENTADA! ---
      const actualHash = await hash(tempPath, 'sha256');
      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        throw new Error(
          `Error de integridad: el hash del paquete no coincide. Esperado: ${expectedHash}, Recibido: ${actualHash}`
        );
      }
      console.log('[Flopy] Verificación de hash exitosa.');
      // ------------------------------------

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

    await unzip(zipPath, newPackagePath);
    await RNFS.unlink(zipPath); // Borra el .zip después de descomprimir
  }

  async cleanupOldUpdates(): Promise<void> {
    const state = stateRepository.getState();
    const activeHashes = [
      state.currentPackage?.hash,
      state.previousPackage?.hash,
    ].filter(Boolean); // Filtra los undefined

    const updateDirs = await RNFS.readDir(this.updatesPath);
    for (const dir of updateDirs) {
      if (dir.isDirectory() && !activeHashes.includes(dir.name)) {
        console.log(`[Flopy] Limpiando actualización antigua: ${dir.name}`);
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

    // Construimos la ruta absoluta al directorio del paquete actual.
    // currentPackage.relativePath es algo como "updates/HASH/index.android.bundle"
    // Necesitamos la ruta a la carpeta "updates/HASH"
    const currentPackageDir = `${this.flopyPath}/updates/${currentPackage.hash}`;

    // 1. Descarga y descomprime el parche
    await this.downloadFile(patch.url, patchZipPath, patch.hash);
    await unzip(patchZipPath, patchTempDir);
    await RNFS.unlink(patchZipPath);

    try {
      // 2. Lee el manifiesto del parche
      const manifestPath = `${patchTempDir}/manifest.json`;
      const manifest = JSON.parse(await RNFS.readFile(manifestPath, 'utf8'));

      // 3. Prepara el nuevo directorio de la actualización copiando el antiguo
      // react-native-fs no tiene copyDirectory, así que lo hacemos manualmente
      await RNFS.mkdir(newPackagePath);
      const filesInCurrentPackage = await RNFS.readDir(currentPackageDir);
      for (const item of filesInCurrentPackage) {
        if (item.isFile()) {
          await RNFS.copyFile(item.path, `${newPackagePath}/${item.name}`);
        } else if (item.isDirectory()) {
          // Manejo simple de un nivel de anidación, como la carpeta 'assets'
          await RNFS.mkdir(`${newPackagePath}/${item.name}`);
          const nestedItems = await RNFS.readDir(item.path);
          for (const nested of nestedItems) {
            await RNFS.copyFile(
              nested.path,
              `${newPackagePath}/${item.name}/${nested.name}`
            );
          }
        }
      }

      // 4. Aplica los cambios del manifiesto
      // 4a. Borra los archivos eliminados
      for (const fileToDelete of manifest.deletedFiles) {
        const fullPath = `${newPackagePath}/${fileToDelete}`;
        if (await RNFS.exists(fullPath)) {
          await RNFS.unlink(fullPath);
        }
      }

      // 4b. Copia los archivos nuevos/binarios
      for (const fileToAdd of manifest.newFiles) {
        const sourcePath = `${patchTempDir}/${fileToAdd}`;
        const destPath = `${newPackagePath}/${fileToAdd}`;
        // Asegurarse de que el directorio padre exista
        await RNFS.mkdir(destPath.substring(0, destPath.lastIndexOf('/')));
        await RNFS.copyFile(sourcePath, destPath);
      }

      // 4c. Aplica los parches de texto
      for (const relativePath in manifest.patchedFiles) {
        const patchContent = manifest.patchedFiles[relativePath];
        const originalFilePath = `${newPackagePath}/${relativePath}`;
        const originalContent = await RNFS.readFile(originalFilePath, 'utf8');

        const newContent = jsdiff.applyPatch(originalContent, patchContent);
        if (newContent === false) {
          throw new Error(
            `Fallo al aplicar el parche para el archivo: ${relativePath}`
          );
        }

        await RNFS.writeFile(originalFilePath, newContent, 'utf8');
      }
    } finally {
      // 5. Limpia el directorio temporal del parche, pase lo que pase
      await RNFS.unlink(patchTempDir);
    }
  }
}

export const updateManager = new UpdateManager();
