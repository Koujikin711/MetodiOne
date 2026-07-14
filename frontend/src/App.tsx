import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "react-hot-toast";

import { ProtectedRoute } from "@/components/ProtectedRoute";
import {
  HomeEntry,
  RequireFinance,
  RequireNotManager,
  RequireOwner,
  RequireOwnerOrAdmin,
  RequireSuperOwner,
} from "@/components/RoleRoutes";
import { MainLayout } from "@/layouts/MainLayout";
import { AnalyticsPage } from "@/pages/AnalyticsPage";
import { AuditPage } from "@/pages/AuditPage";
import { ChatPage } from "@/pages/ChatPage";
import { EmployeesPage } from "@/pages/EmployeesPage";
import { ExpertReportsPage } from "@/pages/ExpertReportsPage";
import { LeadDetailPage } from "@/pages/LeadDetailPage";
import { ForcePasswordPage } from "@/pages/ForcePasswordPage";
import { LoginPage } from "@/pages/LoginPage";
import { MyLeadsPage } from "@/pages/MyLeadsPage";
import { OnlineBookingPage } from "@/pages/OnlineBookingPage";
import { CompaniesPage } from "@/pages/CompaniesPage";
import { CrmPage } from "@/pages/CrmPage";
import { FinancePage } from "@/pages/FinancePage";
import { IntegrationsHubPage } from "@/pages/IntegrationsHubPage";
import { KpiPage } from "@/pages/KpiPage";
import { LandingPage } from "@/pages/LandingPage";
import { DemoHubPage } from "@/pages/DemoHubPage";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { TasksPage } from "@/pages/TasksPage";
import { TeamMessengerPage } from "@/pages/TeamMessengerPage";
import { ManagerDeskPage } from "@/pages/ManagerDeskPage";
import { ServiceCatalogPage } from "@/pages/ServiceCatalogPage";

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/landing" element={<LandingPage />} />
        <Route path="/demos" element={<DemoHubPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/force-password" element={<ForcePasswordPage />} />
          <Route element={<MainLayout />}>
            <Route path="/app" element={<HomeEntry />} />
            <Route path="/desk" element={<ManagerDeskPage />} />
            <Route path="/crm" element={<CrmPage />} />
            <Route path="/my-leads" element={<MyLeadsPage />} />
            <Route path="/booking" element={<OnlineBookingPage />} />
            <Route path="/leads/:id" element={<LeadDetailPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/messenger" element={<TeamMessengerPage />} />
            <Route
              path="/analytics"
              element={
                <RequireOwner>
                  <AnalyticsPage />
                </RequireOwner>
              }
            />
            <Route path="/kpi" element={<KpiPage />} />
            <Route
              path="/finance"
              element={
                <RequireFinance>
                  <FinancePage />
                </RequireFinance>
              }
            />
            <Route path="/reports" element={<ExpertReportsPage />} />
            <Route
              path="/services"
              element={
                <RequireOwnerOrAdmin>
                  <ServiceCatalogPage />
                </RequireOwnerOrAdmin>
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
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/integrations" element={<IntegrationsHubPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route
              path="/companies"
              element={
                <RequireSuperOwner>
                  <CompaniesPage />
                </RequireSuperOwner>
              }
            />
          </Route>
        </Route>
      </Routes>
      <Toaster
        position="top-center"
        containerStyle={{ top: "5.5rem" }}
        toastOptions={{
          duration: 3800,
          style: {
            background: "#ffffff",
            color: "#0f172a",
            padding: "14px 18px",
            borderRadius: "12px",
            boxShadow: "0 8px 24px -6px rgba(99, 102, 241, 0.12), 0 2px 8px -2px rgba(15, 23, 42, 0.08)",
            border: "1px solid #dbe2ef",
          },
        }}
      />
    </>
  );
}
