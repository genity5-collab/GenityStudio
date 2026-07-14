import React from 'react'
import { ArrowRight } from 'lucide-react'

interface HeroProps {
  title: string
  subtitle: string
  primaryButtonText: string
  primaryButtonAction: () => void
  secondaryButtonText?: string
  secondaryButtonAction?: () => void
  backgroundImage?: string
}

function HeroSection({
  title,
  subtitle,
  primaryButtonText,
  primaryButtonAction,
  secondaryButtonText,
  secondaryButtonAction,
  backgroundImage
}: HeroProps) {
  return (
    <section
      className="relative min-h-screen md:min-h-96 flex items-center justify-center px-4 md:px-8 overflow-hidden"
      style={{
        backgroundImage: backgroundImage ? `url(${backgroundImage})` : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Content */}
      <div className="relative z-10 max-w-4xl mx-auto text-center text-white">
        <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-tight">{title}</h1>
        <p className="text-lg md:text-2xl text-gray-100 mb-8 leading-relaxed">{subtitle}</p>

        <div className="flex flex-col md:flex-row gap-4 justify-center">
          <button
            onClick={primaryButtonAction}
            className="bg-white hover:bg-gray-100 text-blue-600 font-bold py-3 px-8 md:py-4 md:px-10 rounded-full transition transform hover:scale-105 flex items-center justify-center gap-2"
          >
            {primaryButtonText}
            <ArrowRight className="w-5 h-5" />
          </button>
          {secondaryButtonText && secondaryButtonAction && (
            <button
              onClick={secondaryButtonAction}
              className="border-2 border-white hover:bg-white/10 text-white font-bold py-3 px-8 md:py-4 md:px-10 rounded-full transition transform hover:scale-105 backdrop-blur"
            >
              {secondaryButtonText}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

export default HeroSection