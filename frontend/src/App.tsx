import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import Dashboard from './pages/Dashboard'
import Profiles from './pages/Profiles'
import Devices from './pages/Devices'
import Proxies from './pages/Proxies'
import Groups from './pages/Groups'
import Rules from './pages/Rules'
import ConfigPreview from './pages/ConfigPreview'
import Login from './pages/Login'
import { ThemeProvider } from './components/ThemeProvider'
import { Toaster } from 'sonner'
import { Navigate, Outlet } from 'react-router-dom'

const ProtectedRoute = () => {
  const token = localStorage.getItem('clash_token')
  if (!token) return <Navigate to="/login" replace />
  return <Outlet />
}

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Toaster theme="dark" position="top-right" />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="profiles" element={<Profiles />} />
              <Route path="devices" element={<Devices />} />
              <Route path="proxies" element={<Proxies />} />
              <Route path="groups" element={<Groups />} />
              <Route path="rules" element={<Rules />} />
              <Route path="config" element={<ConfigPreview />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  )
}

export default App
