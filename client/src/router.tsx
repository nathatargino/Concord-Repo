import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LobbyPage } from './pages/LobbyPage';
import App from './App';
import { Titlebar } from './components/Titlebar';

export function Router() {
  return (
    <HashRouter>
      <Titlebar />
      <Routes>
        <Route path="/" element={<LobbyPage />} />
        <Route path="/room/:roomId" element={<App />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
