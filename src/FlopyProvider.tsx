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

  /**
   * El ciclo de vida `componentDidMount` ahora es el orquestador principal.
   * Realiza una inicialización rápida y luego delega las tareas de red al fondo.
   */
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

      if (state.currentPackage) {
        console.log('[Flopy] Marcando versión actual como exitosa...');

        // SIEMPRE marca como exitosa al cargar
        await NativeBridge.markSuccess();

        // Si había fallos, reporta éxito
        if (state.failedBootCount > 0) {
          apiClient
            .reportStatus(options, state.currentPackage.releaseId, 'SUCCESS')
            .catch(console.error);
        }

        stateRepository.resetBootStatus();
      }

      // Sync en background
      Flopy.sync().catch(console.error);
    } catch (e) {
      console.error('[Flopy] Error en background:', e);
    }
  }
  /**
   * Maneja los crashes de renderizado.
   */

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
            '[Flopy] Crash detectado al inicio. Registrando fallo...'
          );
          stateRepository.recordFailedBoot();

          if (state.failedBootCount + 1 >= 2) {
            console.log(
              '[Flopy] Demasiados fallos. Reportando y revirtiendo...'
            );

            // Reporta el fallo (fire-and-forget)
            apiClient
              .reportStatus(options, state.currentPackage.releaseId, 'FAILURE')
              .catch((e) =>
                console.error('[Flopy] Error reportando fallo:', e)
              );

            this.setState({ isReverting: true });
            await stateRepository.revertToPreviousPackage();
            RNRestart.restart();
          } else {
            // Primer fallo, solo reinicia
            console.log('[Flopy] Primer fallo detectado, reiniciando...');
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
