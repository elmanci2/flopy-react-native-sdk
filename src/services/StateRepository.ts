// src/services/StateRepository.ts

import RNFS from 'react-native-fs';
import NativeBridge from '../native/NativeBridge';
import type { FlopyOptions, FlopyState, PackageInfo } from '../types';

class StateRepository {
  private state: FlopyState | null = null;
  // El tipo ahora refleja que las opciones completas tendrán todo requerido
  private options: Required<FlopyOptions> | null = null;
  private flopyPath: string = '';
  private metadataPath: string = '';
  private isInitialized = false;

  constructor() {} // El constructor se mantiene vacío

  /**
   * Inicializa el repositorio. Debe llamarse una sola vez al configurar la app.
   * Carga las constantes nativas y el estado desde el disco.
   */
  async initialize(developerOptions: FlopyOptions): Promise<void> {
    console.log('[Flopy SR] Iniciando inicialización...');
    if (this.isInitialized) return;

    console.log('[Flopy SR] Obteniendo constantes nativas...');
    const nativeConstants = NativeBridge.getConstants();
    console.log('[Flopy SR] Constantes nativas recibidas:', nativeConstants);

    const autoDetectedVersion = nativeConstants.binaryVersion;
    const autoDetectedUniqueId = nativeConstants.clientUniqueId;

    console.log('[Flopy SR] Fusionando opciones...');
    this.options = {
      ...developerOptions,
      binaryVersion: developerOptions.binaryVersion || autoDetectedVersion,
      clientUniqueId: developerOptions.clientUniqueId || autoDetectedUniqueId,
    };

    this.flopyPath = nativeConstants.flopyPath;
    this.metadataPath = `${this.flopyPath}/metadata.json`;
    console.log(
      `[Flopy SR] Ruta de metadatos establecida a: ${this.metadataPath}`
    );

    try {
      console.log(
        '[Flopy SR] Comprobando si el archivo de metadatos existe...'
      );
      if (await RNFS.exists(this.metadataPath)) {
        console.log('[Flopy SR] Leyendo archivo de metadatos...');
        const content = await RNFS.readFile(this.metadataPath, 'utf8');
        this.state = JSON.parse(content);
      } else {
        console.log(
          '[Flopy SR] Archivo de metadatos no encontrado, creando estado inicial...'
        );
        this.state = {
          failedBootCount: 0,
          currentPackage: undefined,
          previousPackage: undefined,
          pendingUpdate: undefined,
        };
        // --- LLAMADA CORREGIDA ---
        await this.saveState(this.state, true); // Llama con el flag de inicialización
      }
    } catch (e) {
      console.error(
        '[Flopy SR] Error al leer/escribir metadatos, reiniciando estado:',
        e
      );
      this.state = {
        failedBootCount: 0,
        currentPackage: undefined,
        previousPackage: undefined,
        pendingUpdate: undefined,
      };
      // --- LLAMADA CORREGIDA ---
      await this.saveState(this.state, true); // Llama con el flag de inicialización
    }

    this.isInitialized = true;
    console.log('[Flopy SR] Inicialización completada.');
  }

  async recordNewPackage(packageInfo: PackageInfo): Promise<void> {
    this.ensureInitialized();
    const currentState = this.getState();
    const newState: FlopyState = {
      ...currentState,
      previousPackage: currentState.currentPackage,
      currentPackage: packageInfo,
      failedBootCount: 0,
    };
    await this.saveState(newState);
  }

  async recordPendingUpdate(
    packageInfo: PackageInfo,
    isMandatory: boolean
  ): Promise<void> {
    this.ensureInitialized();
    const currentState = this.getState();
    const newState: FlopyState = {
      ...currentState,
      pendingUpdate: { ...packageInfo, isMandatory },
    };
    await this.saveState(newState);
  }

  async clearPendingUpdate(): Promise<void> {
    this.ensureInitialized();
    const currentState = this.getState();
    const newState: FlopyState = { ...currentState, pendingUpdate: undefined };
    await this.saveState(newState);
  }

  async revertToPreviousPackage(): Promise<void> {
    this.ensureInitialized();
    const currentState = this.getState();
    if (!currentState.previousPackage) {
      await this.clearCurrentPackage();
      return;
    }
    const newState: FlopyState = {
      ...currentState,
      currentPackage: currentState.previousPackage,
      previousPackage: undefined,
      failedBootCount: 0,
    };
    await this.saveState(newState);
  }

  async clearCurrentPackage(): Promise<void> {
    this.ensureInitialized();
    const currentState = this.getState();
    const newState: FlopyState = { ...currentState, currentPackage: undefined };
    await this.saveState(newState);
  }

  async recordFailedBoot(): Promise<void> {
    this.ensureInitialized();
    const currentState = this.getState();
    if (!currentState.currentPackage) return;
    const newState = {
      ...currentState,
      failedBootCount: currentState.failedBootCount + 1,
    };
    await this.saveState(newState);
  }

  async resetBootStatus(): Promise<void> {
    this.ensureInitialized();
    const currentState = this.getState();
    if (currentState.failedBootCount > 0) {
      const newState = { ...currentState, failedBootCount: 0 };
      await this.saveState(newState);
    }
  }

  // --- Getters ---

  getOptions(): Required<FlopyOptions> {
    this.ensureInitialized();
    return this.options!;
  }

  getState(): FlopyState {
    this.ensureInitialized();
    return this.state!;
  }

  getCurrentPackage(): PackageInfo | undefined {
    return this.getState().currentPackage;
  }

  getPreviousPackage(): PackageInfo | undefined {
    return this.getState().previousPackage;
  }

  getPendingUpdate(): FlopyState['pendingUpdate'] {
    return this.getState().pendingUpdate;
  }

  getFlopyPath(): string {
    this.ensureInitialized();
    return this.flopyPath;
  }

  // --- Métodos Privados ---

  private async saveState(
    newState: FlopyState,
    isDuringInit: boolean = false
  ): Promise<void> {
    // --- LÓGICA CORREGIDA ---
    this.ensureInitialized(isDuringInit);

    // Si estamos en la inicialización, el flopyPath podría no estar definido todavía.
    // Lo obtenemos de `this` donde ya fue establecido.
    if (this.flopyPath) {
      await RNFS.mkdir(this.flopyPath);
      await RNFS.writeFile(
        this.metadataPath,
        JSON.stringify(newState, null, 2),
        'utf8'
      );
    }
    this.state = newState;
  }

  private ensureInitialized(allowDuringInit: boolean = false) {
    // --- LÓGICA CORREGIDA ---
    if (allowDuringInit) return;

    if (!this.isInitialized || !this.state || !this.options) {
      throw new Error(
        'Flopy no ha sido inicializado. Llama a Flopy.configure() al inicio de tu app.'
      );
    }
  }
}

export const stateRepository = new StateRepository();
