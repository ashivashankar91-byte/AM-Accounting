import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';

// FINAL-R0 Golden Path: gate every /golden-path/* route (except /login)
// behind a real authenticated session. Unauthenticated visitors are bounced
// to /golden-path/login and returned to their original destination after
// signing in.
export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/golden-path/login" state={{ from: location.pathname }} replace />;
  }
  return <>{children}</>;
}
