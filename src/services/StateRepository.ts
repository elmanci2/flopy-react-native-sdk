// src/services/StateRepository.ts

import RNFS from 'react-native-fs';
import NativeBridge from '../native/NativeBridge';
import type { FlopyOptions, FlopyState, PackageInfo } from '../types';

class StateRepository {
  private state: FlopyState | null = null;
  private options: Required<FlopyOptions> | null = null;
  private flopyPath: string = '';
  private metadataPath: string = '';
  private isInitialized = false;

  constructor() {}

  /**
   * Inicializa el repositorio. Es llamado por Flopy._internalConfigure.
   */
  async initialize(options: Required<FlopyOptions>): Promise<void> {
    if (this.isInitialized) return;

    this.options = options;

    const nativeConstants = NativeBridge.getConstants();
    this.flopyPath = nativeConstants.flopyPath;
    this.metadataPath = `${this.flopyPath}/metadata.json`;

    try {
      if (await RNFS.exists(this.metadataPath)) {
        const content = await RNFS.readFile(this.metadataPath, 'utf8');
        this.state = JSON.parse(content);
      } else {
        this.state = {
          failedBootCount: 0,
          currentPackage: undefined,
          previousPackage: undefined,
          pendingUpdate: undefined,
        };
        await this.saveState(this.state);
      }
    } catch (e) {
      console.error(
        '[Flopy SR] Error al cargar/crear metadatos, reiniciando estado:',
        e
      );
      this.state = {
        failedBootCount: 0,
        currentPackage: undefined,
        previousPackage: undefined,
        pendingUpdate: undefined,
      };
      await this.saveState(this.state);
    }

    this.isInitialized = true;
    console.log('[Flopy SR] Repositorio de estado inicializado.');
  }

  /**
   * Guarda un nuevo paquete y actualiza el estado local.
   */
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

  /**
   * Guarda una actualización como "pendiente".
   */
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

  /**
   * Mueve el `previousPackage` a `currentPackage`.
   */
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

  /**
   * Limpia el paquete actual para volver al bundle original.
   */
  async clearCurrentPackage(): Promise<void> {
    this.ensureInitialized();
    const currentState = this.getState();
    const newState: FlopyState = { ...currentState, currentPackage: undefined };
    await this.saveState(newState);
  }

  // --- MÉTODOS QUE DELEGAN AL PUENTE NATIVO ---

  /**
   * Le pide al código nativo que incremente el contador de fallos.
   */
  recordFailedBoot(): void {
    this.ensureInitialized();
    // La lógica de leer y escribir el contador ahora es 100% nativa y más segura.
    NativeBridge.recordFailedBoot();
  }

  /**
   * Le pide al código nativo que resetee el contador de fallos.
   */
  resetBootStatus(): void {
    this.ensureInitialized();
    NativeBridge.resetBootStatus();
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

  private async saveState(newState: FlopyState): Promise<void> {
    this.ensureInitialized(true);
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
    if (allowDuringInit) return;
    if (!this.isInitialized) {
      throw new Error(
        'Flopy no ha sido inicializado. Llama a Flopy.configure() al inicio de tu app.'
      );
    }
  }
}

export const stateRepository = new StateRepository();
