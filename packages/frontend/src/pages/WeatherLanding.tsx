import React from 'react'
import { Cloud, Code2, Zap, BarChart3 } from 'lucide-react'

interface FeatureCardProps {
  icon: React.ReactNode
  title: string
  description: string
}

const FeatureCard: React.FC<FeatureCardProps> = ({ icon, title, description }) => (
  <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 md:p-8 border border-white/20 hover:bg-white/20 transition transform hover:scale-105">
    <div className="text-4xl mb-4">{icon}</div>
    <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
    <p className="text-blue-100">{description}</p>
  </div>
)

function WeatherLanding() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-400 via-blue-500 to-purple-600">
      {/* Navigation */}
      <nav className="bg-white/10 backdrop-blur border-b border-white/20">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2 text-white">
            <Cloud className="w-8 h-8" />
            <span className="text-2xl font-bold">WeatherHub</span>
          </div>
          <div className="hidden md:flex gap-8 text-white">
            <a href="#features" className="hover:text-blue-100 transition">Features</a>
            <a href="#about" className="hover:text-blue-100 transition">About</a>
            <a href="#contact" className="hover:text-blue-100 transition">Contact</a>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="max-w-6xl mx-auto px-4 md:px-8 py-12 md:py-24 text-center text-white">
        <h1 className="text-4xl md:text-6xl font-bold mb-4 leading-tight">
          Real-Time Weather at Your Fingertips
        </h1>
        <p className="text-lg md:text-xl text-blue-100 mb-8 max-w-2xl mx-auto">
          Get accurate weather forecasts, detailed analytics, and real-time updates for any location worldwide.
        </p>
        <div className="flex flex-col md:flex-row gap-4 justify-center">
          <a
            href="/weather-dashboard"
            className="bg-white hover:bg-blue-50 text-blue-600 font-bold py-3 px-8 rounded-full transition transform hover:scale-105 inline-block"
          >
            View Dashboard
          </a>
          <button className="border-2 border-white hover:bg-white/10 text-white font-bold py-3 px-8 rounded-full transition transform hover:scale-105">
            Learn More
          </button>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="max-w-6xl mx-auto px-4 md:px-8 py-12 md:py-20">
        <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-12">Features</h2>
        <div className="grid md:grid-cols-2 gap-6 md:gap-8">
          <FeatureCard
            icon={<Cloud className="w-12 h-12 text-blue-300" />}
            title="Real-Time Updates"
            description="Get live weather data updated every hour with accurate forecasts and conditions."
          />
          <FeatureCard
            icon={<BarChart3 className="w-12 h-12 text-green-300" />}
            title="Detailed Analytics"
            description="View comprehensive weather analytics including humidity, wind speed, and pressure."
          />
          <FeatureCard
            icon={<Zap className="w-12 h-12 text-yellow-300" />}
            title="Fast & Reliable"
            description="Lightning-fast performance with 99.9% uptime guarantee for weather data."
          />
          <FeatureCard
            icon={<Code2 className="w-12 h-12 text-purple-300" />}
            title="Mobile Responsive"
            description="Beautiful, responsive design that works perfectly on all devices and screen sizes."
          />
        </div>
      </section>

      {/* CTA Section */}
      <section className="max-w-6xl mx-auto px-4 md:px-8 py-12 md:py-20 text-center text-white">
        <h2 className="text-3xl md:text-4xl font-bold mb-6">Ready to Check the Weather?</h2>
        <p className="text-lg text-blue-100 mb-8">Start exploring weather data for any location right now.</p>
        <a
          href="/weather-dashboard"
          className="bg-white hover:bg-blue-50 text-blue-600 font-bold py-4 px-10 rounded-full transition transform hover:scale-105 inline-block text-lg"
        >
          Go to Dashboard
        </a>
      </section>
    </div>
  )
}

export default WeatherLanding