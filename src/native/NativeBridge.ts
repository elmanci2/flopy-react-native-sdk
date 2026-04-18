// src/native/NativeBridge.ts
import { NativeModules, NativeEventEmitter } from 'react-native';
import type { FlopyState } from '../types';
import RNRestart from 'react-native-restart';

const LINKING_ERROR = `The package 'flopy-react-native' doesn't seem to be linked.`;

interface INativeBridge {
  restartApp(): void;
  recordFailedBoot(): void;
  resetBootStatus(): void;
  unzip(zipPath: string, destinationPath: string): Promise<boolean>;

  // Métodos de persistencia
  saveState(state: FlopyState): Promise<boolean>;
  readState(): Promise<FlopyState | null>;

  // Métodos de sistema de archivos (reemplazo de RNFS)
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  unlink(path: string): Promise<void>;
  downloadFile(
    url: string,
    destination: string,
    downloadId: string
  ): Promise<void>;
  getSha256(path: string): Promise<string>;
  moveFile(from: string, to: string): Promise<void>;
  readDir(path: string): Promise<string[]>;
  getFileSize(path: string): Promise<number>;

  // Eventos
  addListener(eventName: string): void;
  removeListeners(count: number): void;

  // Métodos optimizados
  switchVersion(releaseId: string, hash: string): Promise<void>;
  markSuccess(): Promise<void>;
  clearFirstTime(): Promise<void>;
  getRolledBackVersion(): Promise<string | null>;
  clearRollbackMark(): Promise<void>;

  getConstants(): {
    flopyPath: string;
    binaryVersion: string;
    clientUniqueId: string;
    serverUrl?: string;
    appId?: string;
    channel?: string;
    deploymentKey?: string;
  };
}

const BaseModule = NativeModules.FlopyModule;

const FlopyModule = BaseModule
  ? (new Proxy(BaseModule, {
      get(target, prop) {
        if (prop === 'getConstants') {
          return () => ({
            flopyPath: target.flopyPath || '',
            binaryVersion: target.binaryVersion || '',
            clientUniqueId: target.clientUniqueId || '',
            serverUrl: target.serverUrl,
            appId: target.appId,
            channel: target.channel,
            deploymentKey: target.deploymentKey,
          });
        }
        const val = target[prop];
        if (typeof val === 'function') {
          return val.bind(target);
        }
        return val;
      },
    }) as INativeBridge)
  : new Proxy({} as INativeBridge, {
      get(_target, prop) {
        if (prop === 'getConstants') {
          return () => ({
            flopyPath: '',
            binaryVersion: '',
            clientUniqueId: '',
          });
        }
        // Cualquier otro acceso a propiedad lanza error de linking.
        // Esto cubre métodos como downloadFile, unzip, etc.
        return (..._args: any[]) => {
          throw new Error(LINKING_ERROR);
        };
      },
    });

const FlopyEventEmitter = new NativeEventEmitter(
  NativeModules.FlopyModule as any
);

export { RNRestart, FlopyEventEmitter };
export default FlopyModule;
