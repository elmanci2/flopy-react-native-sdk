// src/native/NativeBridge.ts
import { NativeModules } from 'react-native';
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
  };
}

const FlopyModule = NativeModules.FlopyModule
  ? (NativeModules.FlopyModule as INativeBridge)
  : new Proxy({} as INativeBridge, {
      get(target, prop) {
        if (prop === 'getConstants') {
          return () => ({
            flopyPath: '',
            binaryVersion: '',
            clientUniqueId: '',
          });
        }
        if (typeof (target as any)[prop] === 'function') {
          throw new Error(LINKING_ERROR);
        }
        return undefined;
      },
    });

export { RNRestart };
export default FlopyModule;
