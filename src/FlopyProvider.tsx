import React, { type ReactNode } from 'react';
import { stateRepository } from './services/StateRepository';
import NativeBridge from './native/NativeBridge';
import { apiClient } from './services/ApiClient';

interface FlopyProviderProps {
  children: ReactNode;
  fallback?: ReactNode; // Un componente a mostrar mientras se revierte
}

interface FlopyProviderState {
  hasError: boolean;
  isReverting: boolean;
}

const CRASH_TIME_LIMIT_MS = 5000; // Si la app crashea en los primeros 5s, es sospechoso

class FlopyProvider extends React.Component<
  FlopyProviderProps,
  FlopyProviderState
> {
  private appStartTime: number;

  constructor(props: FlopyProviderProps) {
    super(props);
    this.state = { hasError: false, isReverting: false };
    this.appStartTime = Date.now();
  }

  static getDerivedStateFromError(_: Error): Partial<FlopyProviderState> {
    return { hasError: true };
  }

  async componentDidCatch(
    error: Error,
    errorInfo: React.ErrorInfo
  ): Promise<void> {
    console.error('[Flopy] Error de renderizado capturado:', error, errorInfo);

    const timeSinceAppStart = Date.now() - this.appStartTime;
    if (timeSinceAppStart <= CRASH_TIME_LIMIT_MS) {
      const state = stateRepository.getState();
      const options = stateRepository.getOptions();

      if (state.currentPackage) {
        console.log('[Flopy] Crash detectado al inicio. Registrando fallo...');
        await stateRepository.recordFailedBoot();

        const newState = stateRepository.getState();
        if (newState.failedBootCount >= 2) {
          console.log('[Flopy] Demasiados fallos. Reverting y reportando...');
          // ¡REPORTA EL FALLO A LA API!
          await apiClient.reportStatus(
            options,
            state.currentPackage.releaseId,
            'FAILURE'
          ); // <-- `releaseId` necesario en el estado
          this.setState({ isReverting: true });
          await stateRepository.revertToPreviousPackage();
          NativeBridge.restartApp(); // Fuerza el reinicio para aplicar el rollback
        }
      }
    }
  }

  async componentDidMount(): Promise<void> {
    try {
      const state = stateRepository.getState();
      const options = stateRepository.getOptions();

      // Si el componente se monta con éxito, significa que el bundle es estable.
      if (state.failedBootCount > 0) {
        console.log(
          '[Flopy] App iniciada con éxito. Reportando éxito y reseteando estado.'
        );
        // ¡REPORTA EL ÉXITO A LA API!
        await apiClient.reportStatus(
          options,
          state.currentPackage!.releaseId,
          'SUCCESS'
        );
        await stateRepository.resetBootStatus();
      }
    } catch (e) {
      console.error(e);
    }
  }

  render() {
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
