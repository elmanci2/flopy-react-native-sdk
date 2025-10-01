// src/services/StateRepository.ts

import NativeBridge from '../native/NativeBridge';
import type { FlopyOptions, FlopyState, PackageInfo } from '../types';

class StateRepository {
  private state: FlopyState | null = null;
  private options: Required<FlopyOptions> | null = null;
  private flopyPath: string = '';
  private isInitialized = false;

  constructor() {}

  async switchToVersion(packageInfo: PackageInfo): Promise<void> {
    this.ensureInitialized();

    console.log(
      '[Flopy SR] switchToVersion llamado con:',
      JSON.stringify(packageInfo)
    );

    // Usa el método optimizado
    await NativeBridge.switchVersion(packageInfo.releaseId, packageInfo.hash);

    console.log('[Flopy SR] switchVersion nativo completado');

    // Actualiza el estado local
    this.state!.previousPackage = this.state!.currentPackage;
    this.state!.currentPackage = packageInfo;
    this.state!.failedBootCount = 0;

    console.log('[Flopy SR] Estado local actualizado');
  }

  async markUpdateSuccess(): Promise<void> {
    this.ensureInitialized();
    await NativeBridge.markSuccess();
    this.state!.failedBootCount = 0;
  }

  async initialize(developerOptions: FlopyOptions): Promise<void> {
    if (this.isInitialized) return;

    const nativeConstants = NativeBridge.getConstants();
    this.options = {
      serverUrl: developerOptions.serverUrl,
      appId: developerOptions.appId,
      channel: developerOptions.channel,
      binaryVersion:
        developerOptions.binaryVersion || nativeConstants.binaryVersion,
      clientUniqueId:
        developerOptions.clientUniqueId || nativeConstants.clientUniqueId,
    };

    const persistedState = await NativeBridge.readState();
    console.log(
      '[Flopy SR] Estado leído desde nativo:',
      JSON.stringify(persistedState, null, 2)
    );

    if (persistedState) {
      this.state = persistedState;
    } else {
      this.state = {
        failedBootCount: 0,
        currentPackage: undefined,
        previousPackage: undefined,
        pendingUpdate: undefined,
      };
    }

    this.isInitialized = true;
    console.log(
      '[Flopy SR] Repositorio inicializado. Estado final:',
      JSON.stringify(this.state, null, 2)
    );
  }

  async recordNewPackage(packageInfo: PackageInfo): Promise<void> {
    this.ensureInitialized();
    this.state!.previousPackage = this.state!.currentPackage;
    this.state!.currentPackage = packageInfo;
    this.state!.failedBootCount = 0;
    await this.saveState();
    this.resetBootStatus();
  }

  async recordPendingUpdate(
    packageInfo: PackageInfo,
    isMandatory: boolean
  ): Promise<void> {
    this.ensureInitialized();
    this.state!.pendingUpdate = { ...packageInfo, isMandatory };
    await this.saveState();
  }
  async clearPendingUpdate(): Promise<void> {
    this.ensureInitialized();
    this.state!.pendingUpdate = undefined;
    await this.saveState();
  }

  async revertToPreviousPackage(): Promise<void> {
    this.ensureInitialized();
    if (!this.state!.previousPackage) {
      this.state!.currentPackage = undefined;
    } else {
      this.state!.currentPackage = this.state!.previousPackage;
      this.state!.previousPackage = undefined;
    }
    this.state!.failedBootCount = 0;
    await this.saveState();
  }

  async clearCurrentPackage(): Promise<void> {
    this.ensureInitialized();
    this.state!.currentPackage = undefined;
    await this.saveState();
  }

  recordFailedBoot(): void {
    this.ensureInitialized();
    NativeBridge.recordFailedBoot();
    if (this.state) {
      this.state.failedBootCount++;
    }
  }

  resetBootStatus(): void {
    this.ensureInitialized();
    NativeBridge.resetBootStatus();
    if (this.state) {
      this.state.failedBootCount = 0;
    }
  }

  private async saveState(): Promise<void> {
    this.ensureInitialized(true);
    await NativeBridge.saveState(this.state!);
  }

  private ensureInitialized(allowDuringInit: boolean = false) {
    if (allowDuringInit) return;
    if (!this.isInitialized) {
      throw new Error('Flopy no ha sido inicializado.');
    }
  }

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
}

export const stateRepository = new StateRepository();
