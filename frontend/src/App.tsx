import { Route, Routes } from "react-router-dom";
import { Toaster } from "react-hot-toast";

import { ProtectedRoute } from "@/components/ProtectedRoute";
import {
  HomeEntry,
  RequireFinance,
  RequireNotManager,
  RequireOwner,
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
import { FinanceShell } from "@/pages/finance/FinanceShell";
import { IntegrationsHubPage } from "@/pages/IntegrationsHubPage";
import { KpiPage } from "@/pages/KpiPage";
import { LandingPage } from "@/pages/LandingPage";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { TasksPage } from "@/pages/TasksPage";
import { TeamMessengerPage } from "@/pages/TeamMessengerPage";
import { ManagerDeskPage } from "@/pages/ManagerDeskPage";

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/landing" element={<LandingPage />} />
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
                  <FinanceShell />
                </RequireFinance>
              }
            >
              <Route index element={<FinancePage />} />
              <Route path="accounting" element={<FinancePage />} />
              <Route path="inventory" element={<FinancePage />} />
              <Route path="reports" element={<FinancePage />} />
            </Route>
            <Route path="/reports" element={<ExpertReportsPage />} />
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
            background: "#faf8f4",
            color: "#1e3348",
            padding: "14px 18px",
            borderRadius: "12px",
            boxShadow: "0 8px 24px -6px rgba(30, 51, 72, 0.15)",
            border: "1px solid #d8d2c6",
          },
        }}
      />
    </>
  );
}
