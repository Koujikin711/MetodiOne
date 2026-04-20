const KEY = "crm_onboarding_done_v1";

export function isOnboardingDone(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true;
  }
}

export function setOnboardingDone(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* ignore */
  }
}
