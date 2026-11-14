import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { NAV_ITEMS } from '@/config/navigation';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { DashboardPage } from '@/pages/DashboardPage';
import { InvitationPage } from '@/pages/InvitationPage';
import { ModulePlaceholder } from '@/pages/ModulePlaceholder';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { BacklogPage } from '@/pages/BacklogPage';
import { BoardsPage } from '@/pages/BoardsPage';
import { EventsPage } from '@/pages/EventsPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { SprintsPage } from '@/pages/SprintsPage';
import { LogbookPage } from '@/pages/LogbookPage';
import { MembersPage } from '@/pages/MembersPage';
import { WorkspacesPage } from '@/pages/WorkspacesPage';
import { ProtectedRoute } from '@/routes/ProtectedRoute';

const BUILT_PAGES = ['/', '/espacios', '/tableros', '/miembros', '/bitacora', '/backlog', '/sprints', '/eventos', '/reportes'];

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/registro" element={<RegisterPage />} />
            <Route path="/recuperar" element={<ForgotPasswordPage />} />
            <Route path="/invitacion/:token" element={<InvitationPage />} />

            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route index element={<DashboardPage />} />
                <Route path="/espacios" element={<WorkspacesPage />} />
                <Route path="/tableros" element={<BoardsPage />} />
                <Route path="/miembros" element={<MembersPage />} />
                <Route path="/bitacora" element={<LogbookPage />} />
                <Route path="/backlog" element={<BacklogPage />} />
                <Route path="/sprints" element={<SprintsPage />} />
                <Route path="/eventos" element={<EventsPage />} />
                <Route path="/reportes" element={<ReportsPage />} />
                {NAV_ITEMS.filter((item) => !BUILT_PAGES.includes(item.to)).map((item) => (
                  <Route key={item.to} path={item.to} element={<ModulePlaceholder item={item} />} />
                ))}
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
