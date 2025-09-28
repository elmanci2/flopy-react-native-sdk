import RNFS from 'react-native-fs';

import NativeBridge from '../native/NativeBridge';

import type { FlopyOptions, FlopyState, PackageInfo } from '../types';

class StateRepository {
  private state: FlopyState | null = null;
  private options: FlopyOptions | null = null;
  private flopyPath: string = '';
  private metadataPath: string = '';
  private isInitialized = false;

  /**
   * Inicializa el repositorio. Debe llamarse una sola vez al configurar la app.
   * Carga las constantes nativas y el estado desde el disco.
   */
  async initialize(developerOptions: FlopyOptions): Promise<void> {
    if (this.isInitialized) return;

    const nativeConstants = NativeBridge.getConstants();
    const autoDetectedVersion = nativeConstants.binaryVersion;
    const autoDetectedUniqueId = nativeConstants.clientUniqueId;

    this.options = {
      ...developerOptions,
      binaryVersion: developerOptions.binaryVersion || autoDetectedVersion,
      clientUniqueId: developerOptions.clientUniqueId || autoDetectedUniqueId,
    };

    if (!this.options.binaryVersion) {
      throw new Error(
        'La versión binaria no pudo ser autodetectada y no fue proporcionada. Por favor, añádela a las opciones de configure().'
      );
    }

    // Obtenemos las rutas directamente del módulo nativo
    const constants = NativeBridge.getConstants();
    this.flopyPath = constants.flopyPath;
    this.metadataPath = `${this.flopyPath}/metadata.json`;

    try {
      if (await RNFS.exists(this.metadataPath)) {
        const content = await RNFS.readFile(this.metadataPath, 'utf8');
        this.state = JSON.parse(content);
      } else {
        // Si el archivo no existe, creamos un estado inicial limpio.
        this.state = { failedBootCount: 0 };
        // --- CORRECCIÓN ---
        await this.saveState(this.state);
      }
    } catch (e) {
      // Si el JSON está corrupto o hay un error, empezamos de cero por seguridad.
      console.error('[Flopy] Error al cargar el estado, se reiniciará:', e);
      this.state = { failedBootCount: 0 };
      // --- CORRECCIÓN ---
      await this.saveState(this.state);
    }

    this.isInitialized = true;
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

  /**
   * Guarda una nueva actualización como el "paquete actual".
   * El paquete que estaba corriendo antes se convierte en el "paquete previo".
   */
  async recordNewPackage(packageInfo: PackageInfo): Promise<void> {
    // <-- CORRECCIÓN: solo 1 argumento
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

  getPreviousPackage(): PackageInfo | undefined {
    this.ensureInitialized();
    return this.getState().previousPackage;
  }

  getPendingUpdate(): FlopyState['pendingUpdate'] {
    this.ensureInitialized();
    return this.getState().pendingUpdate;
  }
  /**
   * Revierte al paquete anterior. Se usa cuando el rollback automático detecta un fallo.
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
   * Borra la información del paquete actual, haciendo que la app vuelva al bundle original.
   */
  async clearCurrentPackage(): Promise<void> {
    this.ensureInitialized();
    const currentState = this.getState();
    const newState: FlopyState = { ...currentState, currentPackage: undefined };
    await this.saveState(newState);
  }

  /**
   * Registra un arranque fallido. Llamado por el FlopyProvider en caso de crash.
   */
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

  /**
   * Resetea el contador de arranques fallidos. Llamado cuando la app arranca con éxito.
   */
  async resetBootStatus(): Promise<void> {
    this.ensureInitialized();
    const currentState = this.getState();
    if (currentState.failedBootCount > 0) {
      const newState = { ...currentState, failedBootCount: 0 };
      await this.saveState(newState);
    }
  }

  // --- Getters ---

  getOptions(): FlopyOptions {
    this.ensureInitialized();
    return this.options!;
  }

  getState(): FlopyState {
    this.ensureInitialized();
    return this.state!;
  }

  getCurrentPackage(): any | undefined {
    return this.getState().currentPackage;
  }

  getFlopyPath(): string {
    this.ensureInitialized();
    return this.flopyPath;
  }

  // --- Métodos Privados ---

  private async saveState(newState: FlopyState): Promise<void> {
    this.ensureInitialized(true); // Permite llamar sin estado/opciones para el guardado inicial
    await RNFS.mkdir(this.flopyPath);
    await RNFS.writeFile(
      this.metadataPath,
      JSON.stringify(newState, null, 2),
      'utf8'
    );
    this.state = newState;
  }

  private ensureInitialized(allowDuringInit: boolean = false) {
    if (allowDuringInit && this.isInitialized) return;
    if (!this.isInitialized || !this.state || !this.options) {
      throw new Error(
        'Flopy no ha sido inicializado. Llama a Flopy.configure() al inicio de tu app.'
      );
    }
  }
}

export const stateRepository = new StateRepository();
