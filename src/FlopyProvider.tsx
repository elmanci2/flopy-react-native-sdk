// src/FlopyProvider.tsx

import React, { type ReactNode } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { stateRepository } from './services/StateRepository';
import { apiClient } from './services/ApiClient';
import NativeBridge from './native/NativeBridge'; // Asumiendo que has unificado tu puente nativo aquí
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

  /**
   * Ejecuta las operaciones de red (reporte y sync) en segundo plano
   * después de que la app se haya renderizado.
   */
  async runBackgroundTasks(): Promise<void> {
    try {
      const state = stateRepository.getState();
      const options = stateRepository.getOptions();
      if (state.currentPackage && state.failedBootCount > 0) {
        console.log(
          '[Flopy] App iniciada con éxito tras un fallo. Reportando éxito en segundo plano...'
        );
        await apiClient.reportStatus(
          options,
          state.currentPackage.releaseId,
          'SUCCESS'
        );
        stateRepository.resetBootStatus();
      }

      console.log('[Flopy] Iniciando sincronización en segundo plano...');
      const status = await Flopy.sync();
      console.log(
        '[Flopy] Sincronización en segundo plano completada con estado:',
        status
      );
    } catch (e) {
      console.error('[Flopy] Error en tareas de fondo:', e);
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
            await apiClient.reportStatus(
              options,
              state.currentPackage.releaseId,
              'FAILURE'
            );
            this.setState({ isReverting: true });
            await stateRepository.revertToPreviousPackage();
            NativeBridge.restartApp();
          }
        }
      } catch (e) {
        console.error('[Flopy] Error dentro de componentDidCatch:', e);
      }
    }
  }

  render() {
    if (!this.state.isInitialized) {
      return (
        this.props.fallback || (
          <View style={styles.container}>
            <ActivityIndicator size="large" />
          </View>
        )
      );
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
