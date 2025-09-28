// src/native/NativeBridge.ts
import { NativeModules } from 'react-native';

const LINKING_ERROR = `The package 'flopy-react-native' doesn't seem to be linked.`;

interface INativeBridge {
  restartApp(): void;
  recordFailedBoot(): void;
  resetBootStatus(): void;

  getConstants(): {
    flopyPath: string;
    initialBundlePath: string;
    binaryVersion: string;
  };
}

const FlopyModule = NativeModules.FlopyModule
  ? (NativeModules.FlopyModule as INativeBridge)
  : new Proxy({} as INativeBridge, {
      get(_, prop) {
        if (prop === 'getConstants') {
          return () => ({
            flopyPath: '',
            initialBundlePath: '',
            binaryVersion: '',
          });
        }
        // Para los métodos de acción
        throw new Error(LINKING_ERROR);
      },
    });

export default FlopyModule;
