import { create } from 'zustand';
import type { User, AuthTokens } from '../types';
import { apiClient } from '../api/apiClient';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  login: (credentials: Record<string, any>) => Promise<void>;
  register: (data: Record<string, any>) => Promise<void>;
  logout: () => Promise<void>;
  fetchProfile: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: !!localStorage.getItem('accessToken'),
  isLoading: false,
  error: null,

  login: async (credentials) => {
    set({ isLoading: true, error: null });
    try {
      const data: AuthTokens = await apiClient.post('/auth/login', credentials);
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);

      set({ isAuthenticated: true, isLoading: false });
      
      // Fetch user profile immediately after login
      const profile: User = await apiClient.get('/auth/me');
      set({ user: profile });
    } catch (err: any) {
      set({ error: err.message || 'Đăng nhập thất bại', isLoading: false });
      throw err;
    }
  },

  register: async (data) => {
    set({ isLoading: true, error: null });
    try {
      // Backend web register endpoint
      await apiClient.post('/auth/register', data);
      set({ isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Đăng ký thất bại', isLoading: false });
      throw err;
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try {
      await apiClient.delete('/auth/logout');
    } catch (err) {
      console.warn('Logout API failed, cleaning local state', err);
    } finally {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  fetchProfile: async () => {
    if (!localStorage.getItem('accessToken')) return;
    set({ isLoading: true });
    try {
      const profile: User = await apiClient.get('/auth/me');
      set({ user: profile, isAuthenticated: true, isLoading: false });
    } catch (err) {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));

// Global listener for automatic logout on 401 token refresh failure
if (typeof window !== 'undefined') {
  window.addEventListener('auth:logout', () => {
    useAuthStore.setState({ user: null, isAuthenticated: false });
  });
}
