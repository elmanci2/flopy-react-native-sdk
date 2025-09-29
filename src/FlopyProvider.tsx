// src/FlopyProvider.tsx

import React, { type ReactNode } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { stateRepository } from './services/StateRepository';
import { apiClient } from './services/ApiClient';
import NativeBridge from './native/NativeBridge';
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

  async componentDidMount(): Promise<void> {
    try {
      console.log(
        '[Flopy] Provider montado. Orquestando inicialización y sync...'
      );

      // --- 1. ÚNICA LLAMADA DE CONFIGURACIÓN ---
      // Flopy._internalConfigure se encarga de todo: autodetección,
      // configuración de apiClient y stateRepository.
      await Flopy._internalConfigure(this.props.options);

      // 2. Si el arranque fue exitoso, resetea el contador y reporta el éxito.
      const state = stateRepository.getState();
      const options = stateRepository.getOptions();
      if (state.currentPackage && state.failedBootCount > 0) {
        console.log(
          '[Flopy] App iniciada con éxito tras un fallo. Reportando éxito...'
        );
        // ¡REPORTA EL ÉXITO A LA API!
        await apiClient.reportStatus(
          options,
          state.currentPackage.releaseId,
          'SUCCESS'
        );
        stateRepository.resetBootStatus(); // Le dice al nativo que resetee el contador
      }

      this.setState({ isInitialized: true });
      console.log(
        '[Flopy] SDK inicializado. Iniciando primera sincronización...'
      );

      // 3. Llama al sync automático después de la inicialización.
      await Flopy.sync();
    } catch (e) {
      console.error('[Flopy] Fallo crítico durante la inicialización:', e);
      this.setState({ isInitialized: true, hasError: true });
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
            '[Flopy] Crash detectado al inicio. Registrando fallo...'
          );

          // 1. Le dice al NATIVO que incremente el contador en el disco.
          // Esto es CRÍTICO para que el próximo arranque falle.
          stateRepository.recordFailedBoot();

          // 2. Comprueba el estado actual en memoria para decidir si revertir.
          if (state.failedBootCount + 1 >= 2) {
            console.log('[Flopy] Demasiados fallos. Reverting y reportando...');

            // Reporta el fallo a la API
            await apiClient.reportStatus(
              options,
              state.currentPackage.releaseId,
              'FAILURE'
            );

            this.setState({ isReverting: true });

            // Actualiza el estado en memoria y lo escribe en el disco
            await stateRepository.revertToPreviousPackage();

            // Reinicia la app
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
      // Si la inicialización falla, no renderizamos nada para evitar más errores.
      return null;
    }

    return this.props.children;
  }
}

export { FlopyProvider };

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
