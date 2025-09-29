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
      isInitialized: false, // <-- Empieza como no inicializado
    };
    this.appStartTime = Date.now();
  }

  static getDerivedStateFromError(_: Error): Partial<FlopyProviderState> {
    return { hasError: true };
  }

  // La inicialización ahora ocurre aquí
  async componentDidMount(): Promise<void> {
    try {
      // 1. Configura e inicializa todos los servicios
      console.log('[Flopy] Provider montado. Inicializando SDK...');
      await Flopy.internalConfigure(this.props.options);
      await stateRepository.initialize(this.props.options);
      apiClient.configure(this.props.options.serverUrl);
      console.log('[Flopy] SDK inicializado con éxito.');

      // 2. Si el componente se monta con éxito, significa que el bundle es estable.
      const state = stateRepository.getState();
      if (state.failedBootCount > 0) {
        console.log(
          '[Flopy] App iniciada con éxito. Reportando éxito y reseteando estado.'
        );
        // (La lógica de reporte de éxito se puede añadir aquí después)
        await stateRepository.resetBootStatus();
      }
    } catch (e) {
      console.error(
        '[Flopy] Fallo crítico durante la inicialización del SDK:',
        e
      );
      this.setState({ hasError: true }); // Marca un error si la inicialización falla
    } finally {
      this.setState({ isInitialized: true }); // Indica que la inicialización ha terminado
    }
  }

  async componentDidCatch(
    error: Error,
    errorInfo: React.ErrorInfo
  ): Promise<void> {
    console.error('[Flopy] Error de renderizado capturado:', error, errorInfo);

    // Esta lógica ahora es segura porque componentDidMount (y la inicialización)
    // se ejecuta antes que componentDidCatch.
    const timeSinceAppStart = Date.now() - this.appStartTime;
    if (timeSinceAppStart <= CRASH_TIME_LIMIT_MS) {
      const state = stateRepository.getState();
      if (state.currentPackage) {
        await stateRepository.recordFailedBoot();
        const newState = stateRepository.getState();
        if (newState.failedBootCount >= 2) {
          this.setState({ isReverting: true });
          await stateRepository.revertToPreviousPackage();
          NativeBridge.restartApp();
        }
      }
    }
  }

  render() {
    // Mientras el SDK se inicializa, muestra una pantalla de carga.
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
      return null;
    }

    return this.props.children;
  }
}

export { FlopyProvider };

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
