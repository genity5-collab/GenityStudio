import React, { useState, useEffect } from 'react'
import { Cloud, CloudRain, Sun, Wind, Droplets, Eye, Gauge } from 'lucide-react'

interface WeatherData {
  temp: number
  condition: string
  humidity: number
  windSpeed: number
  visibility: number
  pressure: number
  feelsLike: number
  icon: string
}

interface LocationData {
  city: string
  country: string
  lat: number
  lon: number
}

function WeatherDashboard() {
  const [location, setLocation] = useState<LocationData>({
    city: 'San Francisco',
    country: 'US',
    lat: 37.7749,
    lon: -122.4194
  })
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [forecast, setForecast] = useState<WeatherData[]>([])
  const [unit, setUnit] = useState<'C' | 'F'>('C')

  // Mock weather data
  const mockWeatherData: { [key: string]: WeatherData } = {
    'san francisco': {
      temp: 22,
      condition: 'Partly Cloudy',
      humidity: 65,
      windSpeed: 12,
      visibility: 10,
      pressure: 1013,
      feelsLike: 20,
      icon: 'cloud'
    },
    'new york': {
      temp: 18,
      condition: 'Rainy',
      humidity: 80,
      windSpeed: 15,
      visibility: 8,
      pressure: 1010,
      feelsLike: 16,
      icon: 'rain'
    },
    'london': {
      temp: 15,
      condition: 'Cloudy',
      humidity: 75,
      windSpeed: 18,
      visibility: 9,
      pressure: 1008,
      feelsLike: 13,
      icon: 'cloud'
    },
    'tokyo': {
      temp: 28,
      condition: 'Sunny',
      humidity: 55,
      windSpeed: 8,
      visibility: 12,
      pressure: 1015,
      feelsLike: 26,
      icon: 'sun'
    },
    'sydney': {
      temp: 25,
      condition: 'Sunny',
      humidity: 60,
      windSpeed: 10,
      visibility: 11,
      pressure: 1012,
      feelsLike: 23,
      icon: 'sun'
    }
  }

  const mockLocations: { [key: string]: LocationData } = {
    'san francisco': { city: 'San Francisco', country: 'US', lat: 37.7749, lon: -122.4194 },
    'new york': { city: 'New York', country: 'US', lat: 40.7128, lon: -74.0060 },
    'london': { city: 'London', country: 'UK', lat: 51.5074, lon: -0.1278 },
    'tokyo': { city: 'Tokyo', country: 'JP', lat: 35.6762, lon: 139.6503 },
    'sydney': { city: 'Sydney', country: 'AU', lat: -33.8688, lon: 151.2093 }
  }

  // Fetch weather data
  const fetchWeather = async (searchCity?: string) => {
    setLoading(true)
    setError(null)
    try {
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const cityKey = (searchCity || location.city).toLowerCase()
      if (mockWeatherData[cityKey]) {
        setWeather(mockWeatherData[cityKey])
        setLocation(mockLocations[cityKey])
        // Generate mock forecast
        setForecast([
          { ...mockWeatherData[cityKey], temp: mockWeatherData[cityKey].temp + 2 },
          { ...mockWeatherData[cityKey], temp: mockWeatherData[cityKey].temp - 1 },
          { ...mockWeatherData[cityKey], temp: mockWeatherData[cityKey].temp + 1 },
          { ...mockWeatherData[cityKey], temp: mockWeatherData[cityKey].temp - 2 },
          { ...mockWeatherData[cityKey], temp: mockWeatherData[cityKey].temp }
        ])
      } else {
        setError('City not found. Try: San Francisco, New York, London, Tokyo, or Sydney')
      }
    } catch (err) {
      setError('Failed to fetch weather data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchWeather()
  }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchInput.trim()) {
      fetchWeather(searchInput)
      setSearchInput('')
    }
  }

  const convertTemp = (celsius: number) => {
    return unit === 'F' ? Math.round((celsius * 9/5) + 32) : celsius
  }

  const getWeatherIcon = (iconType: string) => {
    switch (iconType) {
      case 'rain':
        return <CloudRain className="w-16 h-16 text-blue-400" />
      case 'sun':
        return <Sun className="w-16 h-16 text-yellow-400" />
      default:
        return <Cloud className="w-16 h-16 text-gray-400" />
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-400 via-blue-500 to-purple-600 p-4 md:p-8">
      {/* Header */}
      <header className="max-w-6xl mx-auto mb-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-2">Weather Dashboard</h1>
            <p className="text-blue-100 text-lg">Real-time weather information</p>
          </div>
          <button
            onClick={() => setUnit(unit === 'C' ? 'F' : 'C')}
            className="bg-white/20 hover:bg-white/30 text-white font-bold py-2 px-6 rounded-full transition transform hover:scale-105 backdrop-blur"
          >
            °{unit === 'C' ? 'F' : 'C'}
          </button>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearch} className="relative">
          <input
            type="text"
            placeholder="Search for a city... (San Francisco, New York, London, Tokyo, Sydney)"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full px-6 py-3 md:py-4 rounded-full text-gray-800 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-white shadow-lg"
          />
          <button
            type="submit"
            disabled={loading}
            className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-2 px-6 rounded-full transition"
          >
            {loading ? '...' : 'Search'}
          </button>
        </form>
      </header>

      {/* Error Message */}
      {error && (
        <div className="max-w-6xl mx-auto mb-6 bg-red-500/80 backdrop-blur text-white p-4 rounded-lg">
          {error}
        </div>
      )}

      {/* Main Content */}
      {weather && !loading && (
        <div className="max-w-6xl mx-auto">
          {/* Current Weather Card */}
          <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-6 md:p-8 mb-6 text-white shadow-2xl border border-white/20">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center mb-8">
              <div>
                <h2 className="text-2xl md:text-3xl font-bold mb-2">{location.city}, {location.country}</h2>
                <p className="text-blue-100 text-lg md:text-xl mb-6">Latitude: {location.lat.toFixed(4)}° | Longitude: {location.lon.toFixed(4)}°</p>
                
                <div className="flex items-center gap-6">
                  <div className="flex flex-col">
                    <span className="text-6xl md:text-7xl font-bold">{convertTemp(weather.temp)}°</span>
                    <span className="text-blue-100 text-lg">Feels like {convertTemp(weather.feelsLike)}°</span>
                  </div>
                  <div>
                    {getWeatherIcon(weather.icon)}
                  </div>
                </div>
              </div>

              {/* Weather Details Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white/10 rounded-2xl p-4 backdrop-blur border border-white/10">
                  <div className="flex items-center gap-2 mb-2">
                    <Droplets className="w-5 h-5" />
                    <span className="text-blue-100">Humidity</span>
                  </div>
                  <span className="text-3xl font-bold">{weather.humidity}%</span>
                </div>

                <div className="bg-white/10 rounded-2xl p-4 backdrop-blur border border-white/10">
                  <div className="flex items-center gap-2 mb-2">
                    <Wind className="w-5 h-5" />
                    <span className="text-blue-100">Wind</span>
                  </div>
                  <span className="text-3xl font-bold">{weather.windSpeed} km/h</span>
                </div>

                <div className="bg-white/10 rounded-2xl p-4 backdrop-blur border border-white/10">
                  <div className="flex items-center gap-2 mb-2">
                    <Eye className="w-5 h-5" />
                    <span className="text-blue-100">Visibility</span>
                  </div>
                  <span className="text-3xl font-bold">{weather.visibility} km</span>
                </div>

                <div className="bg-white/10 rounded-2xl p-4 backdrop-blur border border-white/10">
                  <div className="flex items-center gap-2 mb-2">
                    <Gauge className="w-5 h-5" />
                    <span className="text-blue-100">Pressure</span>
                  </div>
                  <span className="text-3xl font-bold">{weather.pressure} mb</span>
                </div>
              </div>
            </div>

            {/* Condition */}
            <div className="bg-white/10 rounded-2xl p-4 backdrop-blur border border-white/10 inline-block">
              <span className="text-lg font-semibold">{weather.condition}</span>
            </div>
          </div>

          {/* 5-Day Forecast */}
          <div>
            <h3 className="text-2xl md:text-3xl font-bold text-white mb-4">5-Day Forecast</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
              {forecast.map((day, index) => (
                <div
                  key={index}
                  className="bg-white/10 backdrop-blur-lg rounded-2xl p-4 text-white text-center shadow-lg border border-white/20 hover:bg-white/20 transition transform hover:scale-105"
                >
                  <p className="text-sm md:text-base font-semibold mb-3 text-blue-100">Day {index + 1}</p>
                  <div className="flex justify-center mb-3">
                    {getWeatherIcon(day.icon)}
                  </div>
                  <p className="text-2xl md:text-3xl font-bold mb-2">{convertTemp(day.temp)}°</p>
                  <p className="text-xs md:text-sm text-blue-100">{day.condition}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            {['San Francisco', 'New York', 'London', 'Tokyo'].map((city) => (
              <button
                key={city}
                onClick={() => {
                  fetchWeather(city)
                }}
                className="bg-white/10 hover:bg-white/20 backdrop-blur text-white font-bold py-3 px-4 rounded-xl transition transform hover:scale-105 border border-white/20"
              >
                {city}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="max-w-6xl mx-auto flex justify-center items-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-white border-t-transparent mx-auto mb-4"></div>
            <p className="text-white text-xl font-semibold">Loading weather data...</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default WeatherDashboard