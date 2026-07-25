import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppError } from "@/components/feedback/AppError";
import { StartupScreen } from "@/components/feedback/StartupScreen";
import { AppShell } from "@/components/layout/AppShell";
import { LibraryProvider, useLibrary } from "@/features/library/LibraryProvider";
import { GameDetailPage } from "@/pages/GameDetailPage";
import { LibraryPage } from "@/pages/LibraryPage";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { SettingsPage } from "@/pages/SettingsPage";

function AppRoutes() {
  const { bootstrap, loading, error } = useLibrary();
  const location = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  if (loading) return <StartupScreen />;
  if (error && !bootstrap) return <AppError message={error} />;

  return (
    <AnimatePresence mode="wait">
      <motion.div key={location.pathname} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
        <Routes location={location}>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route element={<AppShell />}>
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/games/:gameId" element={<GameDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to={bootstrap?.configured ? "/library" : "/onboarding"} replace />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

export function App() {
  return <LibraryProvider><AppRoutes /></LibraryProvider>;
}
