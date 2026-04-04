import { BrowserRouter, Routes, Route } from "react-router";
import { useState, useEffect, createContext, useContext } from "react";
import { Sessions } from "./pages/Sessions.js";
import { SessionDetail } from "./pages/SessionDetail.js";
import { Settings } from "./pages/Settings.js";
import { DailyList } from "./pages/DailyList.js";
import { DailyNotes } from "./pages/DailyNotes.js";
import { LandingPage } from "./pages/LandingPage.js";
import { Sidebar } from "./components/Sidebar.js";
import { getProjects, getStats } from "./lib/api.js";
import type { Stats } from "./lib/types.js";

interface AppContextType {
  projects: Array<{
    project_path: string;
    session_count: number;
    last_activity: string;
    exchange_count: number;
    org: string;
    repo: string;
    short_path: string;
  }>;
  stats: Stats | null;
  selectedProject: string | null;
  setSelectedProject: (p: string | null) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}

export const AppContext = createContext<AppContextType>({
  projects: [],
  stats: null,
  selectedProject: null,
  setSelectedProject: () => {},
  searchQuery: "",
  setSearchQuery: () => {},
});

export const useAppContext = () => useContext(AppContext);

export function App() {
  const [projects, setProjects] = useState<AppContextType["projects"]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    getProjects().then(setProjects).catch(console.error);
    (getStats() as Promise<Stats>).then(setStats).catch(console.error);
  }, []);

  return (
    <AppContext.Provider
      value={{
        projects,
        stats,
        selectedProject,
        setSelectedProject,
        searchQuery,
        setSearchQuery,
      }}
    >
      <BrowserRouter>
        <Routes>
          <Route path="/landing" element={<LandingPage />} />
          <Route path="/*" element={
            <div className="flex h-full">
              <Sidebar />
              <main className="flex-1 overflow-y-auto">
                <Routes>
                  <Route path="/" element={<Sessions />} />
                  <Route path="/sessions/:id" element={<SessionDetail />} />
                  <Route path="/daily" element={<DailyList />} />
                  <Route path="/daily/:date" element={<DailyNotes />} />
                  <Route path="/settings" element={<Settings />} />
                </Routes>
              </main>
            </div>
          } />
        </Routes>
      </BrowserRouter>
    </AppContext.Provider>
  );
}
