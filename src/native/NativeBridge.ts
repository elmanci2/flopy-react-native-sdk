// src/native/NativeBridge.ts
import { NativeModules } from 'react-native';

const LINKING_ERROR = `The package 'flopy-react-native' doesn't seem to be linked.`;

interface INativeBridge {
  // --- Métodos de Acción Existentes ---
  restartApp(): void;
  recordFailedBoot(): void;
  resetBootStatus(): void;

  // --- ¡NUEVO MÉTODO DE ACCIÓN! ---
  /**
   * Descomprime un archivo .zip en un directorio de destino usando lógica nativa.
   * @param zipPath La ruta absoluta al archivo .zip.
   * @param destinationPath La ruta absoluta al directorio de destino.
   * @returns Una promesa que se resuelve si la descompresión es exitosa.
   */
  unzip(zipPath: string, destinationPath: string): Promise<boolean>;

  /**
   * Aplica un parche a un archivo original usando lógica nativa.
   * @param originalFilePath La ruta absoluta al archivo original.
   * @param patchString El parche en formato string.
   * @returns Una promesa que se resuelve si el parche es exitoso.
   */
  applyPatch(originalFilePath: string, patchString: string): Promise<boolean>;
  // --- Constantes ---
  getConstants(): {
    flopyPath: string;
    // initialBundlePath ya no es necesario, lo podemos quitar para simplificar
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
