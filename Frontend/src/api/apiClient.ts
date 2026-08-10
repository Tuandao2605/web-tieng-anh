import axios from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import type { ApiResponse, AuthTokens } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value?: unknown) => void;
  reject: (reason?: any) => void;
}> = [];

const processQueue = (error: any = null, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Request Interceptor: Attach Access Token
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const accessToken = localStorage.getItem('accessToken');
    if (accessToken && config.headers) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor: Extract data & Handle Token Refresh on 401
apiClient.interceptors.response.use(
  (response) => {
    // Unwrap API response format from backend ({ obj: { success, data, message } })
    const resData: ApiResponse = response.data;
    if (resData?.obj) {
      return resData.obj.data !== undefined ? resData.obj.data : resData.obj;
    }
    if (resData?.data !== undefined) {
      return resData.data;
    }
    return resData;
  },
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return apiClient(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem('refreshToken');

      if (!refreshToken) {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.dispatchEvent(new Event('auth:logout'));
        return Promise.reject(error);
      }

      try {
        // Attempt to refresh token
        const response = await axios.post(`${API_BASE_URL}/auth/refresh-token`, {
          refreshToken,
        });

        const newTokens: AuthTokens = response.data?.obj?.data || response.data?.data || response.data;

        if (newTokens?.accessToken) {
          localStorage.setItem('accessToken', newTokens.accessToken);
          if (newTokens.refreshToken) {
            localStorage.setItem('refreshToken', newTokens.refreshToken);
          }

          apiClient.defaults.headers.common['Authorization'] = `Bearer ${newTokens.accessToken}`;
          originalRequest.headers.Authorization = `Bearer ${newTokens.accessToken}`;

          processQueue(null, newTokens.accessToken);
          return apiClient(originalRequest);
        } else {
          throw new Error('Refresh token invalid');
        }
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.dispatchEvent(new Event('auth:logout'));
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }

    const message =
      error.response?.data?.message ||
      error.response?.data?.error?.message ||
      error.message ||
      'An error occurred';
      
    return Promise.reject(new Error(message));
  }
);
