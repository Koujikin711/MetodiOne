import { Route, Routes } from "react-router-dom";
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
import { AttendanceTrackerPage } from "@/pages/AttendanceTrackerPage";
import { AuditPage } from "@/pages/AuditPage";
import { BillingTariffPage } from "@/pages/BillingPage";
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
import { HorecaPlaceholderPage } from "@/pages/HorecaPlaceholderPage";
import { HorecaOrdersPage } from "@/pages/HorecaOrdersPage";
import { HorecaTablesPage } from "@/pages/HorecaTablesPage";
import { HorecaFinancePage } from "@/pages/HorecaFinancePage";
import { HorecaAnalyticsPage } from "@/pages/HorecaAnalyticsPage";
import { HorecaGuestsPage } from "@/pages/HorecaGuestsPage";
import { HorecaKitchenPage } from "@/pages/HorecaKitchenPage";
import { HorecaStockPage } from "@/pages/HorecaStockPage";
import { HorecaShiftTasksPage } from "@/pages/HorecaShiftTasksPage";
import { HorecaCommsPage } from "@/pages/HorecaCommsPage";
import { HorecaDeliveryPage } from "@/pages/HorecaDeliveryPage";
import { HorecaForecastPage } from "@/pages/HorecaForecastPage";
import { IntegrationsHubPage } from "@/pages/IntegrationsHubPage";
import { KpiPage } from "@/pages/KpiPage";
import { LandingPage } from "@/pages/LandingPage";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { TariffPlansPage } from "@/pages/TariffPlansPage";
import { TasksPage } from "@/pages/TasksPage";
import { HorecaPrepPage } from "@/pages/HorecaPrepPage";
import { HorecaTeamPage } from "@/pages/HorecaTeamPage";
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
            <Route
              path="/billing"
              element={
                <RequireOwnerOrAdmin>
                  <BillingTariffPage />
                </RequireOwnerOrAdmin>
              }
            />
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
            <Route path="/horeca" element={<HorecaPlaceholderPage />} />
            <Route path="/horeca/orders" element={<HorecaOrdersPage />} />
            <Route path="/horeca/tables" element={<HorecaTablesPage />} />
            <Route path="/horeca/finance" element={<HorecaFinancePage />} />
            <Route path="/horeca/analytics" element={<HorecaAnalyticsPage />} />
            <Route path="/horeca/guests" element={<HorecaGuestsPage />} />
            <Route path="/horeca/kitchen" element={<HorecaKitchenPage />} />
            <Route path="/horeca/stock" element={<HorecaStockPage />} />
            <Route path="/horeca/shift-tasks" element={<HorecaShiftTasksPage />} />
            <Route path="/horeca/comms" element={<HorecaCommsPage />} />
            <Route path="/horeca/delivery" element={<HorecaDeliveryPage />} />
            <Route path="/horeca/prep" element={<HorecaPrepPage />} />
            <Route path="/horeca/forecast" element={<HorecaForecastPage />} />
            <Route path="/horeca/team" element={<HorecaTeamPage />} />
            <Route path="/attendance" element={<AttendanceTrackerPage />} />
            <Route
              path="/companies"
              element={
                <RequireSuperOwner>
                  <CompaniesPage />
                </RequireSuperOwner>
              }
            />
            <Route
              path="/tariff-plans"
              element={
                <RequireSuperOwner>
                  <TariffPlansPage />
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
