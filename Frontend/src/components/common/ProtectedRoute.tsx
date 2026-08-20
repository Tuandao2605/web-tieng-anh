import React, { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../store/useAuthStore';

export const ProtectedRoute: React.FC = () => {
  const { isAuthenticated, isInitialized, fetchProfile, isLoading } = useAuthStore();

  useEffect(() => {
    if (!isInitialized) void fetchProfile();
  }, [fetchProfile, isInitialized]);

  // Do not mount protected pages while an existing access token is being
  // verified/refreshed. This prevents an anonymous /sets request racing auth.
  if (!isInitialized || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};
