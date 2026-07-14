import { useState } from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import ResponsiveNavbar from './components/ResponsiveNavbar'
import Footer from './components/Footer'
import Landing from './pages/Landing'
import Builder from './pages/Builder'
import Dashboard from './pages/Dashboard'
import WeatherDashboard from './pages/WeatherDashboard'
import WeatherLanding from './pages/WeatherLanding'

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  return (
    <Router>
      <div className="flex flex-col min-h-screen">
        <ResponsiveNavbar />
        
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Landing setIsLoggedIn={setIsLoggedIn} />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/builder/:projectId" element={<Builder />} />
            <Route path="/weather" element={<WeatherLanding />} />
            <Route path="/weather-dashboard" element={<WeatherDashboard />} />
          </Routes>
        </main>
        
        <Footer />
      </div>
    </Router>
  )
}

export default App