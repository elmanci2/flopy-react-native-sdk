// src/FlopyProvider.tsx

import React, { type ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { stateRepository } from './services/StateRepository';
import { apiClient } from './services/ApiClient';
import NativeBridge, { RNRestart } from './native/NativeBridge';
import type { FlopyOptions } from './types';

// Lazy import para romper la dependencia circular FlopyProvider <-> index
const getFlopy = () => require('./index').default;

interface FlopyProviderProps {
  children: ReactNode;
  options: FlopyOptions;
  fallback?: ReactNode;
}

interface FlopyProviderState {
  hasError: boolean;
  isReverting: boolean;
  isInitialized: boolean;
}

const CRASH_TIME_LIMIT_MS = 5000;

class FlopyProvider extends React.Component<
  FlopyProviderProps,
  FlopyProviderState
> {
  private appStartTime: number;
  private hasMarkedSuccess: boolean = false;
  private successTimer: ReturnType<typeof setTimeout> | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private isMounted_: boolean = false;

  constructor(props: FlopyProviderProps) {
    super(props);
    this.state = {
      hasError: false,
      isReverting: false,
      isInitialized: false,
    };
    this.appStartTime = Date.now();
  }

  static getDerivedStateFromError(_: Error): Partial<FlopyProviderState> {
    return { hasError: true };
  }

  componentDidMount(): void {
    this.isMounted_ = true;
    getFlopy()
      ._internalConfigure(this.props.options)
      .then(() => {
        if (this.isMounted_) {
          this.setState({ isInitialized: true });
          this.runBackgroundTasks();
        }
      })
      .catch((e: Error) => {
        console.error('[Flopy] Fallo crítico durante la inicialización:', e);
        if (this.isMounted_) {
          this.setState({ isInitialized: true, hasError: true });
        }
      });
  }

  componentWillUnmount(): void {
    this.isMounted_ = false;
    if (this.successTimer) {
      clearTimeout(this.successTimer);
      this.successTimer = null;
    }
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
  }

  private async runBackgroundTasks(): Promise<void> {
    try {
      const state = stateRepository.getState();
      const options = stateRepository.getOptions();

      console.log('[Flopy] Estado al iniciar:', JSON.stringify(state, null, 2));

      // CRÍTICO: Solo marca como exitosa si es una versión estable
      // (failedBootCount === 0 significa que NO es la primera vez)
      if (state.currentPackage) {
        if (state.failedBootCount === 0) {
          console.log(
            '[Flopy] ✅ Versión estable detectada, marcando como exitosa...'
          );
          if (!this.hasMarkedSuccess) {
            await NativeBridge.markSuccess();
            this.hasMarkedSuccess = true;
          }
        } else {
          console.log(
            '[Flopy] ⏳ Primera carga de nueva versión (failedBootCount:',
            state.failedBootCount,
            ')'
          );
          console.log('[Flopy] Esperando confirmación de estabilidad...');

          // Después de 3 segundos sin crash, marca como exitosa
          this.successTimer = setTimeout(async () => {
            if (!this.isMounted_) return;
            try {
              console.log(
                '[Flopy] ✅ 3 segundos sin crash, marcando como exitosa...'
              );
              await NativeBridge.markSuccess();
              this.hasMarkedSuccess = true;

              // Reporta éxito al servidor
              apiClient
                .reportStatus(
                  options,
                  state.currentPackage!.releaseId,
                  'SUCCESS'
                )
                .catch(console.error);

              stateRepository.resetBootStatus();
            } catch (e) {
              console.error('[Flopy] Error al marcar éxito:', e);
            }
          }, 3000);
        }
      } else {
        console.log('[Flopy] No hay versión OTA activa, usando bundle nativo');
      }

      // Sync en background (sin bloquear)
      this.syncTimer = setTimeout(() => {
        getFlopy().sync().catch(console.error);
      }, 1000);
    } catch (e) {
      console.error('[Flopy] Error en background:', e);
    }
  }

  async componentDidCatch(
    error: Error,
    errorInfo: React.ErrorInfo
  ): Promise<void> {
    console.error('[Flopy] Error de renderizado capturado:', error, errorInfo);

    const timeSinceAppStart = Date.now() - this.appStartTime;

    if (timeSinceAppStart <= CRASH_TIME_LIMIT_MS) {
      try {
        const state = stateRepository.getState();
        const options = stateRepository.getOptions();

        if (state.currentPackage) {
          console.log(
            '[Flopy] ❌ Crash detectado al inicio. Registrando fallo...'
          );
          await stateRepository.recordFailedBoot();

          if (state.failedBootCount + 1 >= 2) {
            console.log(
              '[Flopy] ⚠️ Demasiados fallos. Reportando y revirtiendo...'
            );

            apiClient
              .reportStatus(options, state.currentPackage.releaseId, 'FAILURE')
              .catch((e) =>
                console.error('[Flopy] Error reportando fallo:', e)
              );

            this.setState({ isReverting: true });
            await stateRepository.revertToPreviousPackage();

            // Espera a que se persista
            await new Promise<void>((resolve) => setTimeout(resolve, 100));

            RNRestart.restart();
          } else {
            console.log('[Flopy] ⚠️ Primer fallo detectado, reiniciando...');

            // Espera a que se persista el contador
            await new Promise<void>((resolve) => setTimeout(resolve, 100));

            RNRestart.restart();
          }
        }
      } catch (e) {
        console.error('[Flopy] Error dentro de componentDidCatch:', e);
      }
    }
  }

  render() {
    if (!this.state.isInitialized) {
      return this.props.fallback || <View style={styles.container} />;
    }

    if (this.state.hasError && this.state.isReverting) {
      // Está revirtiendo a una versión anterior, mostrar fallback
      return this.props.fallback || <View style={styles.container} />;
    }

    // Si hay error pero NO estamos revirtiendo, mostrar fallback.
    // React no resetea el error boundary, así que re-renderizar
    // children que ya fallaron causaría un crash loop infinito.
    if (this.state.hasError) {
      return this.props.fallback || <View style={styles.container} />;
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});

export { FlopyProvider };

/**
 * HOC estilo CodePush para envolver la app con el sistema OTA de Flopy.
 *
 * @example
 * // Con opciones
 * MyApp = flopy({ serverUrl: '...', appId: '...' })(MyApp);
 *
 * // Sin opciones (lee config del nativo)
 * MyApp = flopy()(MyApp);
 *
 * // También disponible como Flopy.wrap()
 * MyApp = Flopy.wrap({ serverUrl: '...', appId: '...' })(MyApp);
 */
export function flopy(options: FlopyOptions = {}) {
  return function wrap<P extends Record<string, any>>(
    WrappedComponent: React.ComponentType<P>
  ): React.ComponentType<P> {
    class FlopyHOC extends React.Component<P> {
      render() {
        return (
          <FlopyProvider options={options}>
            <WrappedComponent {...this.props} />
          </FlopyProvider>
        );
      }
    }

    // Display name para React DevTools
    const displayName =
      (WrappedComponent as any).displayName ||
      WrappedComponent.name ||
      'Component';
    (FlopyHOC as any).displayName = `Flopy(${displayName})`;

    return FlopyHOC;
  };
}
