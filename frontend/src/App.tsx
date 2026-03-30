import { Route, Routes } from "react-router-dom";
import { Toaster } from "react-hot-toast";

import { ProtectedRoute } from "@/components/ProtectedRoute";
import { MainLayout } from "@/layouts/MainLayout";
import { AnalyticsPage } from "@/pages/AnalyticsPage";
import { CrmPage } from "@/pages/CrmPage";
import { EmployeesPage } from "@/pages/EmployeesPage";
import { LeadDetailPage } from "@/pages/LeadDetailPage";
import { LoginPage } from "@/pages/LoginPage";
import { OnlineBookingPage } from "@/pages/OnlineBookingPage";
import { TasksPage } from "@/pages/TasksPage";

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<MainLayout />}>
            <Route path="/" element={<CrmPage />} />
            <Route path="/booking" element={<OnlineBookingPage />} />
            <Route path="/leads/:id" element={<LeadDetailPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/employees" element={<EmployeesPage />} />
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
