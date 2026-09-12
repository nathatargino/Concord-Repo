import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { LobbyPage } from './pages/LobbyPage';
import App from './App';
import { Titlebar } from './components/Titlebar';
import { PiPPlayer } from './components/PiPPlayer';

function AppContent() {
  const location = useLocation();
  const isPip = location.pathname === '/pip';

  return (
    <>
      {!isPip && <Titlebar />}
      <Routes>
        <Route path="/" element={<LobbyPage />} />
        <Route path="/room/:roomId" element={<App />} />
        <Route path="/pip" element={<PiPPlayer />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export function Router() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}

