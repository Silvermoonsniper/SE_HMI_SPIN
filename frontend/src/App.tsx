import { Navigate, Route, Routes } from 'react-router-dom'
import { AppDialogHost } from './components/dialogs/AppDialogHost'
import StartPage from './pages/StartPage'
import SystemPage from './pages/SystemPage'
import HistoryPage from './pages/HistoryPage'
import PlotPage from './pages/PlotPage'

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<StartPage />} />
        <Route path="/system" element={<SystemPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/plot" element={<PlotPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <AppDialogHost />
    </>
  )
}
