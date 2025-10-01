Flopy React Native SDK
Sistema de actualizaciones OTA (Over-The-Air) para aplicaciones React Native con soporte para rollback automático y gestión de versiones.

Características

Actualizaciones OTA: Descarga y aplica actualizaciones sin pasar por las tiendas de aplicaciones
Rollback automático: Detecta crashes y revierte automáticamente a la versión anterior
Actualizaciones mandatory: Fuerza actualizaciones críticas inmediatamente
Gestión de canales: Separa entornos (Production, Staging, Development)
Seguridad por deployment key: Valida permisos específicos por canal
Limpieza automática: Elimina versiones antiguas para optimizar espacio
Arquitectura nueva de React Native: Compatible con Fabric y TurboModules


Instalación
bashnpm install flopy-react-native
# o
yarn add flopy-react-native
Dependencias peer
bashnpm install react-native-fs react-native-restart
Configuración Android
En android/app/src/main/java/com/tuapp/MainApplication.kt:
kotlinimport com.remoteupdate.Flopy

class MainApplication : Application(), ReactApplication {
    override val reactNativeHost: ReactNativeHost =
        object : DefaultReactNativeHost(this) {
            // ... configuración existente ...

            override fun getJSBundleFile(): String? {
                return Flopy.getInstance(applicationContext).getJSBundleFile()
            }
        }
}

Uso básico
1. Envuelve tu app con FlopyProvider
typescriptimport { FlopyProvider } from 'flopy-react-native';

function App() {
  return (
    <FlopyProvider
      options={{
        serverUrl: 'https://api.tuservidor.com',
        appId: 'tu-app-id',
        channel: 'Production',
        deploymentKey: 'tu-deployment-key-production',
      }}
    >
      <TuApp />
    </FlopyProvider>
  );
}
2. Sincroniza actualizaciones
typescriptimport Flopy, { SyncStatus } from 'flopy-react-native';

async function checkForUpdates() {
  const status = await Flopy.sync();

  if (status === SyncStatus.UPDATE_INSTALLED) {
    console.log('Actualización aplicada');
  }
}

API
FlopyProvider
Componente que inicializa el SDK y maneja errores de renderizado.
Props:
typescriptinterface FlopyProviderProps {
  children: ReactNode;
  options: FlopyOptions;
  fallback?: ReactNode; // Componente mostrado durante inicialización
}
FlopyOptions
typescriptinterface FlopyOptions {
  serverUrl: string;          // URL del servidor de actualizaciones
  appId: string;              // ID de la aplicación
  channel: string;            // Canal (Production, Staging, etc.)
  deploymentKey: string;      // Clave de despliegue del canal
  binaryVersion?: string;     // Versión del binario (auto-detectada)
  clientUniqueId?: string;    // ID único del dispositivo (auto-detectado)
}
Flopy.sync()
Chequea y aplica actualizaciones disponibles.
typescriptFlopy.sync(options?: SyncOptions): Promise<SyncStatus>
Opciones:
typescriptinterface SyncOptions {
  installMode?: InstallMode;          // Cuándo instalar updates normales
  mandatoryInstallMode?: InstallMode; // Cuándo instalar updates mandatory
}

enum InstallMode {
  IMMEDIATE = 'IMMEDIATE',           // Reinicia inmediatamente
  ON_NEXT_RESTART = 'ON_NEXT_RESTART' // Aplica en próximo reinicio
}
Respuestas:
typescriptenum SyncStatus {
  UP_TO_DATE = 'UP_TO_DATE',         // Sin actualizaciones
  UPDATE_INSTALLED = 'UPDATE_INSTALLED', // Actualización descargada/instalada
  ERROR = 'ERROR'                     // Error durante sync
}
Ejemplo:
typescriptimport Flopy, { InstallMode } from 'flopy-react-native';

// Updates normales esperan al próximo reinicio
// Updates mandatory se aplican inmediatamente
const status = await Flopy.sync({
  installMode: InstallMode.ON_NEXT_RESTART,
  mandatoryInstallMode: InstallMode.IMMEDIATE,
});
Flopy.rollback()
Revierte manualmente a la versión anterior.
typescriptFlopy.rollback(): Promise<void>
Ejemplo:
typescriptawait Flopy.rollback(); // Reinicia con la versión anterior
Flopy.getUpdateMetadata()
Obtiene información de la actualización actual.
typescriptFlopy.getUpdateMetadata(): Promise<PackageInfo | undefined>

interface PackageInfo {
  releaseId: string;
  hash: string;
  relativePath: string;
}

Flujos de actualización
Actualización normal (no mandatory)

Usuario abre la app
Flopy.sync() descarga la actualización
Actualización queda pendiente
Usuario cierra y reabre la app
Actualización se aplica automáticamente
App carga con la nueva versión

Actualización mandatory

Usuario abre la app
Flopy.sync() detecta actualización mandatory
Descarga inmediatamente
Aplica y reinicia automáticamente
App carga con la nueva versión

Rollback automático ante crash

Actualización se aplica
App crashea durante los primeros 5 segundos
Sistema detecta el fallo
Revierte automáticamente a la versión anterior
App carga con la versión estable
Se reporta el fallo al servidor


Gestión de canales
Flopy soporta múltiples canales para separar entornos:
typescript// Production
<FlopyProvider
  options={{
    serverUrl: 'https://api.tuservidor.com',
    appId: 'tu-app-id',
    channel: 'Production',
    deploymentKey: 'production-key-xyz',
  }}
/>

// Staging
<FlopyProvider
  options={{
    serverUrl: 'https://api.tuservidor.com',
    appId: 'tu-app-id',
    channel: 'Staging',
    deploymentKey: 'staging-key-abc',
  }}
/>
Deployment Keys:
Cada canal tiene su propio deployment key que valida:

Permisos para ese canal específico
Pertenencia a la aplicación correcta
Previene actualizaciones accidentales entre canales


Sistema de rollback
Protección automática en 3 capas
1. Detección de crash al inicio
Si la app crashea en los primeros 5 segundos, se considera un fallo crítico.
2. Rollback automático en Kotlin
Al reiniciar, el sistema nativo detecta que la versión no fue marcada como exitosa y revierte automáticamente.
3. Contador de fallos
Si el rollback también falla, después de 2 intentos revierte a la versión base (assets).
Versiones en disco
El sistema mantiene máximo 2 versiones:

currentPackage: Versión actual en uso
previousPackage: Versión anterior (respaldo)

Las versiones antiguas se eliminan automáticamente al marcar una actualización como exitosa.

Ejemplo completo
typescriptimport React, { useEffect } from 'react';
import { View, Text, Button } from 'react-native';
import { FlopyProvider } from 'flopy-react-native';
import Flopy, { SyncStatus, InstallMode } from 'flopy-react-native';

function MainApp() {
  useEffect(() => {
    // Chequea actualizaciones al montar
    checkForUpdates();
  }, []);

  const checkForUpdates = async () => {
    try {
      const status = await Flopy.sync({
        installMode: InstallMode.ON_NEXT_RESTART,
        mandatoryInstallMode: InstallMode.IMMEDIATE,
      });

      if (status === SyncStatus.UPDATE_INSTALLED) {
        console.log('Actualización lista. Reinicia la app para aplicarla.');
      } else if (status === SyncStatus.UP_TO_DATE) {
        console.log('App actualizada');
      }
    } catch (error) {
      console.error('Error chequeando actualizaciones:', error);
    }
  };

  const handleRollback = async () => {
    await Flopy.rollback();
  };

  return (
    <View>
      <Text>Mi App con Flopy</Text>
      <Button title="Buscar actualizaciones" onPress={checkForUpdates} />
      <Button title="Revertir actualización" onPress={handleRollback} />
    </View>
  );
}

export default function App() {
  return (
    <FlopyProvider
      options={{
        serverUrl: 'https://updates.miapp.com',
        appId: 'mi-app-id',
        channel: 'Production',
        deploymentKey: 'prod-key-12345',
      }}
    >
      <MainApp />
    </FlopyProvider>
  );
}

Troubleshooting
La actualización no se aplica

Verifica que el deploymentKey sea correcto para el canal
Revisa los logs de Logcat: adb logcat | grep Flopy
Confirma que el bundle existe: /data/data/com.tuapp/files/flopy/updates/

Bucle de reinicios
El sistema detecta crashes y revierte automáticamente. Si hay bucle infinito:

Desinstala y reinstala la app
Revisa los logs del servidor para ver qué actualización está causando el problema

Pantalla en blanco al cargar
Si la app queda en blanco >5 segundos:

El bundle puede ser muy grande (optimiza con Hermes)
Verifica que getJSBundleFile() esté configurado en MainApplication


Licencia
MIT

Soporte
Para reportar bugs o solicitar features, abre un issue en el repositorio.Flopy React Native SDK
Sistema de actualizaciones OTA (Over-The-Air) para aplicaciones React Native con soporte para rollback automático y gestión de versiones.

Características

Actualizaciones OTA: Descarga y aplica actualizaciones sin pasar por las tiendas de aplicaciones
Rollback automático: Detecta crashes y revierte automáticamente a la versión anterior
Actualizaciones mandatory: Fuerza actualizaciones críticas inmediatamente
Gestión de canales: Separa entornos (Production, Staging, Development)
Seguridad por deployment key: Valida permisos específicos por canal
Limpieza automática: Elimina versiones antiguas para optimizar espacio
Arquitectura nueva de React Native: Compatible con Fabric y TurboModules


Instalación
bashnpm install flopy-react-native
# o
yarn add flopy-react-native
Dependencias peer
bashnpm install react-native-fs react-native-restart
Configuración Android
En android/app/src/main/java/com/tuapp/MainApplication.kt:
kotlinimport com.remoteupdate.Flopy

class MainApplication : Application(), ReactApplication {
    override val reactNativeHost: ReactNativeHost =
        object : DefaultReactNativeHost(this) {
            // ... configuración existente ...

            override fun getJSBundleFile(): String? {
                return Flopy.getInstance(applicationContext).getJSBundleFile()
            }
        }
}

Uso básico
1. Envuelve tu app con FlopyProvider
typescriptimport { FlopyProvider } from 'flopy-react-native';

function App() {
  return (
    <FlopyProvider
      options={{
        serverUrl: 'https://api.tuservidor.com',
        appId: 'tu-app-id',
        channel: 'Production',
        deploymentKey: 'tu-deployment-key-production',
      }}
    >
      <TuApp />
    </FlopyProvider>
  );
}
2. Sincroniza actualizaciones
typescriptimport Flopy, { SyncStatus } from 'flopy-react-native';

async function checkForUpdates() {
  const status = await Flopy.sync();

  if (status === SyncStatus.UPDATE_INSTALLED) {
    console.log('Actualización aplicada');
  }
}

API
FlopyProvider
Componente que inicializa el SDK y maneja errores de renderizado.
Props:
typescriptinterface FlopyProviderProps {
  children: ReactNode;
  options: FlopyOptions;
  fallback?: ReactNode; // Componente mostrado durante inicialización
}
FlopyOptions
typescriptinterface FlopyOptions {
  serverUrl: string;          // URL del servidor de actualizaciones
  appId: string;              // ID de la aplicación
  channel: string;            // Canal (Production, Staging, etc.)
  deploymentKey: string;      // Clave de despliegue del canal
  binaryVersion?: string;     // Versión del binario (auto-detectada)
  clientUniqueId?: string;    // ID único del dispositivo (auto-detectado)
}
Flopy.sync()
Chequea y aplica actualizaciones disponibles.
typescriptFlopy.sync(options?: SyncOptions): Promise<SyncStatus>
Opciones:
typescriptinterface SyncOptions {
  installMode?: InstallMode;          // Cuándo instalar updates normales
  mandatoryInstallMode?: InstallMode; // Cuándo instalar updates mandatory
}

enum InstallMode {
  IMMEDIATE = 'IMMEDIATE',           // Reinicia inmediatamente
  ON_NEXT_RESTART = 'ON_NEXT_RESTART' // Aplica en próximo reinicio
}
Respuestas:
typescriptenum SyncStatus {
  UP_TO_DATE = 'UP_TO_DATE',         // Sin actualizaciones
  UPDATE_INSTALLED = 'UPDATE_INSTALLED', // Actualización descargada/instalada
  ERROR = 'ERROR'                     // Error durante sync
}
Ejemplo:
typescriptimport Flopy, { InstallMode } from 'flopy-react-native';

// Updates normales esperan al próximo reinicio
// Updates mandatory se aplican inmediatamente
const status = await Flopy.sync({
  installMode: InstallMode.ON_NEXT_RESTART,
  mandatoryInstallMode: InstallMode.IMMEDIATE,
});
Flopy.rollback()
Revierte manualmente a la versión anterior.
typescriptFlopy.rollback(): Promise<void>
Ejemplo:
typescriptawait Flopy.rollback(); // Reinicia con la versión anterior
Flopy.getUpdateMetadata()
Obtiene información de la actualización actual.
typescriptFlopy.getUpdateMetadata(): Promise<PackageInfo | undefined>

interface PackageInfo {
  releaseId: string;
  hash: string;
  relativePath: string;
}

Flujos de actualización
Actualización normal (no mandatory)

Usuario abre la app
Flopy.sync() descarga la actualización
Actualización queda pendiente
Usuario cierra y reabre la app
Actualización se aplica automáticamente
App carga con la nueva versión

Actualización mandatory

Usuario abre la app
Flopy.sync() detecta actualización mandatory
Descarga inmediatamente
Aplica y reinicia automáticamente
App carga con la nueva versión

Rollback automático ante crash

Actualización se aplica
App crashea durante los primeros 5 segundos
Sistema detecta el fallo
Revierte automáticamente a la versión anterior
App carga con la versión estable
Se reporta el fallo al servidor


Gestión de canales
Flopy soporta múltiples canales para separar entornos:
typescript// Production
<FlopyProvider
  options={{
    serverUrl: 'https://api.tuservidor.com',
    appId: 'tu-app-id',
    channel: 'Production',
    deploymentKey: 'production-key-xyz',
  }}
/>

// Staging
<FlopyProvider
  options={{
    serverUrl: 'https://api.tuservidor.com',
    appId: 'tu-app-id',
    channel: 'Staging',
    deploymentKey: 'staging-key-abc',
  }}
/>
Deployment Keys:
Cada canal tiene su propio deployment key que valida:

Permisos para ese canal específico
Pertenencia a la aplicación correcta
Previene actualizaciones accidentales entre canales


Sistema de rollback
Protección automática en 3 capas
1. Detección de crash al inicio
Si la app crashea en los primeros 5 segundos, se considera un fallo crítico.
2. Rollback automático en Kotlin
Al reiniciar, el sistema nativo detecta que la versión no fue marcada como exitosa y revierte automáticamente.
3. Contador de fallos
Si el rollback también falla, después de 2 intentos revierte a la versión base (assets).
Versiones en disco
El sistema mantiene máximo 2 versiones:

currentPackage: Versión actual en uso
previousPackage: Versión anterior (respaldo)

Las versiones antiguas se eliminan automáticamente al marcar una actualización como exitosa.

Ejemplo completo
typescriptimport React, { useEffect } from 'react';
import { View, Text, Button } from 'react-native';
import { FlopyProvider } from 'flopy-react-native';
import Flopy, { SyncStatus, InstallMode } from 'flopy-react-native';

function MainApp() {
  useEffect(() => {
    // Chequea actualizaciones al montar
    checkForUpdates();
  }, []);

  const checkForUpdates = async () => {
    try {
      const status = await Flopy.sync({
        installMode: InstallMode.ON_NEXT_RESTART,
        mandatoryInstallMode: InstallMode.IMMEDIATE,
      });

      if (status === SyncStatus.UPDATE_INSTALLED) {
        console.log('Actualización lista. Reinicia la app para aplicarla.');
      } else if (status === SyncStatus.UP_TO_DATE) {
        console.log('App actualizada');
      }
    } catch (error) {
      console.error('Error chequeando actualizaciones:', error);
    }
  };

  const handleRollback = async () => {
    await Flopy.rollback();
  };

  return (
    <View>
      <Text>Mi App con Flopy</Text>
      <Button title="Buscar actualizaciones" onPress={checkForUpdates} />
      <Button title="Revertir actualización" onPress={handleRollback} />
    </View>
  );
}

export default function App() {
  return (
    <FlopyProvider
      options={{
        serverUrl: 'https://updates.miapp.com',
        appId: 'mi-app-id',
        channel: 'Production',
        deploymentKey: 'prod-key-12345',
      }}
    >
      <MainApp />
    </FlopyProvider>
  );
}

Troubleshooting
La actualización no se aplica

Verifica que el deploymentKey sea correcto para el canal
Revisa los logs de Logcat: adb logcat | grep Flopy
Confirma que el bundle existe: /data/data/com.tuapp/files/flopy/updates/

Bucle de reinicios
El sistema detecta crashes y revierte automáticamente. Si hay bucle infinito:

Desinstala y reinstala la app
Revisa los logs del servidor para ver qué actualización está causando el problema

Pantalla en blanco al cargar
Si la app queda en blanco >5 segundos:

El bundle puede ser muy grande (optimiza con Hermes)
Verifica que getJSBundleFile() esté configurado en MainApplication


Licencia
MIT

Soporte
Para reportar bugs o solicitar features, abre un issue en el repositorio.
