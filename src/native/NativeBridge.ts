// src/native/NativeBridge.ts
import { NativeModules } from 'react-native';

const LINKING_ERROR = `The package 'flopy-react-native' doesn't seem to be linked.`;

// La interfaz ahora refleja 1:1 las capacidades de nuestro módulo Kotlin
interface INativeBridge {
  // --- Métodos de Acción ---
  restartApp(): void;
  recordFailedBoot(): void;
  resetBootStatus(): void;

  // --- Constantes (accedidas de forma diferente) ---
  getConstants(): {
    flopyPath: string;
    initialBundlePath: string;
  };
}

const FlopyModule = NativeModules.FlopyModule
  ? (NativeModules.FlopyModule as INativeBridge)
  : new Proxy({} as INativeBridge, {
      get(_, prop) {
        // Para los métodos que devuelven constantes
        if (prop === 'getConstants') {
          return () => ({ flopyPath: '', initialBundlePath: '' });
        }
        // Para los métodos de acción
        throw new Error(LINKING_ERROR);
      },
    });

export default FlopyModule;
