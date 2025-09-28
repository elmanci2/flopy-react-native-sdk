// src/types/sdk.ts

export interface FlopyOptions {
  serverUrl: string;
  appId: string;
  channel: string;

  binaryVersion?: string;
  clientUniqueId?: string;
}

export enum SyncStatus {
  CHECKING_FOR_UPDATE = 'CHECKING_FOR_UPDATE',
  DOWNLOADING = 'DOWNLOADING',
  APPLYING_PATCH = 'APPLYING_PATCH',
  EXTRACTING = 'EXTRACTING',
  INSTALLING = 'INSTALLING',
  UP_TO_DATE = 'UP_TO_DATE',
  UPDATE_INSTALLED = 'UPDATE_INSTALLED',
  ERROR = 'ERROR',
}

/**
 * La estructura de nuestra metadata local (flopy-metadata.json).
 */
export interface LocalState {
  currentPackage?: PackageInfo;
  previousPackage?: PackageInfo;
  failedBootCount: number;
  pendingUpdate?: PackageInfo & { releaseId: string; isMandatory: boolean }; // Nuevo
}

export interface PackageInfo {
  /** El hash SHA-256 del paquete, usado como identificador único. */
  hash: string;

  /** La ruta relativa al archivo de bundle JS dentro del directorio de Flopy. */
  relativePath: string;

  /** El ID de la release del servidor, necesario para reportar el estado. */
  releaseId: string; // <-- AÑADE ESTA LÍNEA
}

export enum InstallMode {
  IMMEDIATE,
  ON_NEXT_RESTART,
}

export interface SyncOptions {
  installMode?: InstallMode;
  mandatoryInstallMode?: InstallMode;
}

export interface FlopyState {
  /**
   * Describe el paquete de actualización que se está ejecutando actualmente.
   * Si es `undefined`, significa que la app está corriendo el bundle original del APK.
   */
  currentPackage?: PackageInfo;

  /**
   * Describe el paquete de actualización que se estaba ejecutando ANTES
   * del `currentPackage`. Es el objetivo del rollback.
   */
  previousPackage?: PackageInfo;

  /**
   * Un contador que se incrementa cada vez que la app crashea al inicio.
   * Si supera un umbral (ej. 2), el orquestador nativo ignora el `currentPackage`
   * para prevenir bucles de crashes.
   */
  failedBootCount: number;

  /**
   * Describe una actualización que ha sido descargada pero está esperando
   * a ser instalada (ej. en el próximo reinicio).
   */
  pendingUpdate?: PackageInfo & { isMandatory: boolean };
}
