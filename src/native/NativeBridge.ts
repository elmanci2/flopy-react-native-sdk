// src/native/NativeBridge.ts
import { NativeModules } from 'react-native';
import type { FlopyState } from '../types';

const LINKING_ERROR = `The package 'flopy-react-native' doesn't seem to be linked.`;

interface INativeBridge {
  restartApp(): void;
  recordFailedBoot(): void;
  resetBootStatus(): void;
  unzip(zipPath: string, destinationPath: string): Promise<boolean>;
  applyPatch(originalFilePath: string, patchString: string): Promise<boolean>;

  // Métodos de persistencia
  saveState(state: FlopyState): Promise<boolean>;
  readState(): Promise<FlopyState | null>;

  getConstants(): {
    flopyPath: string;
    binaryVersion: string;
    clientUniqueId: string;
  };
}
// Asegúrate de que el nombre del módulo sea el correcto
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
        // Para todos los métodos de acción, lanza el error
        if (typeof (target as any)[prop] === 'function') {
          throw new Error(LINKING_ERROR);
        }
        // Maneja el caso en que se acceda a una propiedad que no es un método
        return undefined;
      },
    });

export default FlopyModule;
