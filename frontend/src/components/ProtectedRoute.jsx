import React from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import AccessDenied from '../pages/AccessDenied.jsx';

function ProtectedRoute({ children, moduleKey, requireSectionHead = false }) {
  const auth = useAuth();
  const location = useLocation();
  const params = useParams();
  const activeModuleKey = moduleKey || params.moduleKey;

  if (auth.loading) {
    return <div className="empty-state">Restoring session...</div>;
  }

  if (!auth.user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (requireSectionHead && !auth.isSectionHead) {
    return <AccessDenied />;
  }

  if (activeModuleKey && !auth.canAccessModule(activeModuleKey)) {
    return <AccessDenied />;
  }

  return children;
}

export default ProtectedRoute;
