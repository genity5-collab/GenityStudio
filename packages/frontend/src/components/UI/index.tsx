import React from 'react'
import { Heart, MessageCircle, Share2 } from 'lucide-react'

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'danger' | 'outline'
  size?: 'sm' | 'md' | 'lg'
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
}

const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  children,
  onClick,
  disabled = false,
  className = ''
}) => {
  const baseStyles = 'font-bold rounded-lg transition transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed'

  const variants = {
    primary: 'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white',
    secondary: 'bg-slate-700 hover:bg-slate-600 text-white',
    danger: 'bg-red-500 hover:bg-red-600 text-white',
    outline: 'border-2 border-slate-400 hover:border-slate-300 text-slate-300 hover:text-white'
  }

  const sizes = {
    sm: 'py-1 px-3 text-sm',
    md: 'py-2 px-4 text-base',
    lg: 'py-3 px-6 text-lg'
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </button>
  )
}

interface CardProps {
  children: React.ReactNode
  className?: string
  hover?: boolean
}

const Card: React.FC<CardProps> = ({ children, className = '', hover = true }) => (
  <div
    className={`bg-slate-800 border border-slate-700 rounded-lg p-6 ${
      hover ? 'hover:border-purple-500/50' : ''
    } transition ${className}`}
  >
    {children}
  </div>
)

interface InputProps {
  type?: string
  placeholder?: string
  value?: string
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  disabled?: boolean
  className?: string
}

const Input: React.FC<InputProps> = ({
  type = 'text',
  placeholder = '',
  value,
  onChange,
  disabled = false,
  className = ''
}) => (
  <input
    type={type}
    placeholder={placeholder}
    value={value}
    onChange={onChange}
    disabled={disabled}
    className={`w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 ${className}`}
  />
)

interface BadgeProps {
  children: React.ReactNode
  variant?: 'success' | 'warning' | 'danger' | 'info'
}

const Badge: React.FC<BadgeProps> = ({ children, variant = 'info' }) => {
  const variants = {
    success: 'bg-green-500/20 text-green-300',
    warning: 'bg-yellow-500/20 text-yellow-300',
    danger: 'bg-red-500/20 text-red-300',
    info: 'bg-blue-500/20 text-blue-300'
  }

  return (
    <span className={`${variants[variant]} text-xs font-semibold px-3 py-1 rounded-full`}>
      {children}
    </span>
  )
}

interface SocialButtonProps {
  type: 'like' | 'comment' | 'share'
  count?: number
  onClick?: () => void
}

const SocialButton: React.FC<SocialButtonProps> = ({ type, count = 0, onClick }) => {
  const icons = {
    like: <Heart className="w-5 h-5" />,
    comment: <MessageCircle className="w-5 h-5" />,
    share: <Share2 className="w-5 h-5" />
  }

  const labels = {
    like: 'Like',
    comment: 'Comment',
    share: 'Share'
  }

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 text-slate-400 hover:text-white transition"
    >
      {icons[type]}
      <span className="text-sm">{labels[type]} {count > 0 && `(${count})`}</span>
    </button>
  )
}

export { Button, Card, Input, Badge, SocialButton }