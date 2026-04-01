import { Route, Routes } from "react-router-dom";
import { Toaster } from "react-hot-toast";

import { ProtectedRoute } from "@/components/ProtectedRoute";
import { HomeEntry, RequireNotManager } from "@/components/RoleRoutes";
import { MainLayout } from "@/layouts/MainLayout";
import { AnalyticsPage } from "@/pages/AnalyticsPage";
import { AuditPage } from "@/pages/AuditPage";
import { ChatPage } from "@/pages/ChatPage";
import { EmployeesPage } from "@/pages/EmployeesPage";
import { LeadDetailPage } from "@/pages/LeadDetailPage";
import { LoginPage } from "@/pages/LoginPage";
import { MyLeadsPage } from "@/pages/MyLeadsPage";
import { OnlineBookingPage } from "@/pages/OnlineBookingPage";
import { TasksPage } from "@/pages/TasksPage";

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<MainLayout />}>
            <Route path="/" element={<HomeEntry />} />
            <Route path="/my-leads" element={<MyLeadsPage />} />
            <Route path="/booking" element={<OnlineBookingPage />} />
            <Route path="/leads/:id" element={<LeadDetailPage />} />
            <Route
              path="/tasks"
              element={
                <RequireNotManager>
                  <TasksPage />
                </RequireNotManager>
              }
            />
            <Route
              path="/analytics"
              element={
                <RequireNotManager>
                  <AnalyticsPage />
                </RequireNotManager>
              }
            />
            <Route
              path="/employees"
              element={
                <RequireNotManager>
                  <EmployeesPage />
                </RequireNotManager>
              }
            />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/audit" element={<AuditPage />} />
          </Route>
        </Route>
      </Routes>
      <Toaster
        position="top-center"
        containerStyle={{ top: "5.5rem" }}
        toastOptions={{
          duration: 3800,
          style: {
            background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 55%, #a855f7 100%)",
            color: "#f8fafc",
            padding: "14px 18px",
            borderRadius: "14px",
            boxShadow: "0 18px 40px -12px rgba(99, 102, 241, 0.55)",
            border: "1px solid rgba(255,255,255,0.12)",
          },
        }}
      />
    </>
  );
}
