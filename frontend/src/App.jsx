import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import DashboardLayout from "./components/DashboardLayout";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import DashboardPage from "./pages/DashboardPage";
import TemplatesPage from "./pages/TemplatesPage";
import TemplateEditorPage from "./pages/TemplateEditorPage";
import SendPage from "./pages/SendPage";
import NotificationsPage from "./pages/NotificationsPage";
import NotificationLogsPage from "./pages/NotificationLogsPage";
import WhatsAppPage from "./pages/WhatsAppPage";
import ProfilePage from "./pages/ProfilePage";
import SettingsPage from "./pages/SettingsPage";
import SchedulesPage from "./pages/SchedulesPage";
import ScheduleEditorPage from "./pages/ScheduleEditorPage";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Protected routes */}
        <Route element={<ProtectedRoute />}>
          <Route element={<DashboardLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/templates" element={<TemplatesPage />} />
            <Route path="/templates/new" element={<TemplateEditorPage />} />
            <Route
              path="/templates/:templateId/edit"
              element={<TemplateEditorPage />}
            />
            <Route path="/send" element={<SendPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route
              path="/notification-logs"
              element={<NotificationLogsPage />}
            />
            <Route path="/whatsapp" element={<WhatsAppPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/schedules" element={<SchedulesPage />} />
            <Route path="/schedules/new" element={<ScheduleEditorPage />} />
            <Route
              path="/schedules/:scheduleId/edit"
              element={<ScheduleEditorPage />}
            />
            <Route path="/profile" element={<ProfilePage />} />
          </Route>
        </Route>

        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
}
