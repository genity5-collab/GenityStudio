import React, { useState } from 'react'
import { Cloud, Menu, X } from 'lucide-react'
import { Link } from 'react-router-dom'

interface MobileNavProps {
  isOpen: boolean
  onClose: () => void
}

const MobileNav: React.FC<MobileNavProps> = ({ isOpen, onClose }) => {
  return (
    <div
      className={`fixed inset-0 z-50 md:hidden ${
        isOpen ? 'block' : 'hidden'
      }`}
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur"
        onClick={onClose}
      />
      <div className="absolute right-0 top-0 h-screen w-64 bg-slate-800 border-l border-slate-700 p-6 overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white"
        >
          <X className="w-6 h-6" />
        </button>
        <div className="mt-12 space-y-4 flex flex-col">
          <Link
            to="/"
            className="text-white hover:text-purple-400 font-bold py-2"
            onClick={onClose}
          >
            Home
          </Link>
          <Link
            to="/dashboard"
            className="text-white hover:text-purple-400 font-bold py-2"
            onClick={onClose}
          >
            Dashboard
          </Link>
          <Link
            to="/weather-dashboard"
            className="text-white hover:text-purple-400 font-bold py-2"
            onClick={onClose}
          >
            Weather
          </Link>
          <button className="bg-purple-500 hover:bg-purple-600 text-white font-bold py-2 px-4 rounded mt-4 w-full">
            Sign In
          </button>
        </div>
      </div>
    </div>
  )
}

function ResponsiveNavbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <>
      <nav className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2">
              <Cloud className="w-6 h-6 text-purple-400" />
              <span className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent hidden md:inline">
                GenityNexys
              </span>
              <span className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent md:hidden">
                Nexys
              </span>
            </Link>

            {/* Desktop Menu */}
            <div className="hidden md:flex items-center gap-8">
              <Link to="/" className="text-slate-400 hover:text-white transition">
                Home
              </Link>
              <Link to="/dashboard" className="text-slate-400 hover:text-white transition">
                Projects
              </Link>
              <Link to="/weather-dashboard" className="text-slate-400 hover:text-white transition">
                Weather
              </Link>
              <button className="bg-purple-500 hover:bg-purple-600 text-white font-bold py-2 px-6 rounded transition">
                Get Started
              </button>
            </div>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden text-slate-400 hover:text-white"
            >
              <Menu className="w-6 h-6" />
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Navigation */}
      <MobileNav isOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
    </>
  )
}

export default ResponsiveNavbar