// src/FlopyProvider.tsx

import React, { type ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { stateRepository } from './services/StateRepository';
import { apiClient } from './services/ApiClient';
import NativeBridge, { RNRestart } from './native/NativeBridge';
import type { FlopyOptions } from './types';
import Flopy from './index';

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
    Flopy._internalConfigure(this.props.options)
      .then(() => {
        this.setState({ isInitialized: true });
        this.runBackgroundTasks();
      })
      .catch((e) => {
        console.error('[Flopy] Fallo crítico durante la inicialización:', e);
        this.setState({ isInitialized: true, hasError: true });
      });
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
          setTimeout(async () => {
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
      setTimeout(() => {
        Flopy.sync().catch(console.error);
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
          stateRepository.recordFailedBoot();

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
            await new Promise((resolve: any) => setTimeout(resolve, 100));

            RNRestart.restart();
          } else {
            console.log('[Flopy] ⚠️ Primer fallo detectado, reiniciando...');

            // Espera a que se persista el contador
            await new Promise((resolve: any) => setTimeout(resolve, 100));

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
      return this.props.fallback || null;
    }

    if (this.state.hasError) {
      return this.props.children;
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});

export { FlopyProvider };
