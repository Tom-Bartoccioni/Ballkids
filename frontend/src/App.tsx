import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { Toaster } from './components/ui/toaster'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import BallkidsPage from './pages/BallkidsPage'
import BallkidDetailPage from './pages/BallkidDetailPage'
import BallkidEditPage from './pages/BallkidEditPage'
import BallkidNewPage from './pages/BallkidNewPage'
import PendingBallkidsPage from './pages/PendingBallkidsPage'
import SelectionPage from './pages/SelectionPage'
import TrainingPage from './pages/TrainingPage'
import SchedulePage from './pages/SchedulePage'
import CoachesPage from './pages/CoachesPage'
import SelectionScorePage from './pages/SelectionScorePage'
import TrainingScorePage from './pages/TrainingScorePage'

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/ballkids" element={<BallkidsPage />} />
            <Route path="/ballkids/new" element={<BallkidNewPage />} />
            <Route path="/ballkids/pending" element={<PendingBallkidsPage />} />
            <Route path="/ballkids/:id" element={<BallkidDetailPage />} />
            <Route path="/ballkids/:id/edit" element={<BallkidEditPage />} />
            <Route path="/selection" element={<SelectionPage />} />
            <Route path="/selection/score/:ballkidId" element={<SelectionScorePage />} />
            <Route path="/training" element={<TrainingPage />} />
            <Route path="/training/score/:sessionNumber/:ballkidId" element={<TrainingScorePage />} />
            <Route path="/schedule" element={<SchedulePage />} />
            <Route path="/coaches" element={<CoachesPage />} />
          </Route>
        </Route>
      </Routes>
      <Toaster />
    </AuthProvider>
  )
}

export default App
