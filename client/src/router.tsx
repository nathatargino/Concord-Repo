import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LobbyPage } from './pages/LobbyPage';
import App from './App';

export function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LobbyPage />} />
        <Route path="/room/:roomId" element={<App />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
