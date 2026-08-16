import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/layout/Layout';
import { ProtectedRoute } from './components/common/ProtectedRoute';
import { LoginPage } from './pages/Auth/LoginPage';
import { RegisterPage } from './pages/Auth/RegisterPage';
import { DashboardPage } from './pages/Dashboard/DashboardPage';
import { SetDetailPage } from './pages/Study/SetDetailPage';
import { LearnModePage } from './pages/Study/LearnModePage';
import { QuizModePage } from './pages/Study/QuizModePage';
import { WriteModePage } from './pages/Study/WriteModePage';
import { SetCreatorPage } from './pages/Study/SetCreatorPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 15,    // 15 minutes
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <Layout>
        <ProtectedRoute />
      </Layout>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'set/create', element: <SetCreatorPage /> },
      { path: 'set/:id', element: <SetDetailPage /> },
      { path: 'set/:id/edit', element: <SetCreatorPage /> },
      { path: 'set/:id/learn', element: <LearnModePage /> },
      { path: 'set/:id/quiz', element: <QuizModePage /> },
      { path: 'set/:id/write', element: <WriteModePage /> },
    ],
  },
  {
    path: '/login',
    element: <Layout><LoginPage /></Layout>,
  },
  {
    path: '/register',
    element: <Layout><RegisterPage /></Layout>,
  },
]);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
