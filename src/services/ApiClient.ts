// src/services/ApiClient.ts

import axios, { type AxiosInstance } from 'axios';
import type { FlopyOptions } from '../types';
import type { CheckForUpdateResponse } from '../types';

class ApiClient {
  private client: AxiosInstance;
  private isConfigured = false;

  constructor() {
    this.client = axios.create({
      headers: { 'Content-Type': 'application/json' },
    });
  }

  configure(serverUrl: string, deploymentKey: string): void {
    this.client.defaults.baseURL = serverUrl;
    this.client.defaults.headers.common['X-Deployment-Key'] = deploymentKey;
    this.isConfigured = true;
  }

  private ensureConfigured(): void {
    if (!this.isConfigured) {
      throw new Error(
        'ApiClient no configurado. Llama a Flopy.configure() primero.'
      );
    }
  }

  async checkForUpdate(
    options: FlopyOptions,
    currentPackageHash?: string
  ): Promise<CheckForUpdateResponse> {
    this.ensureConfigured();

    const payload = {
      appId: options.appId,
      channel: options.channel,
      clientBinaryVersion: options.binaryVersion,
      currentReleaseHash: currentPackageHash,
    };

    const response = await this.client.post<CheckForUpdateResponse>(
      '/check-for-update',
      payload
    );
    return response.data;
  }

  async reportStatus(
    options: FlopyOptions,
    releaseId: string,
    status: 'SUCCESS' | 'FAILURE'
  ): Promise<void> {
    this.ensureConfigured();

    const payload = {
      releaseId,
      clientUniqueId: options.clientUniqueId,
      status,
    };

    await this.client.post('/report-status', payload);
  }
}

export const apiClient = new ApiClient();
