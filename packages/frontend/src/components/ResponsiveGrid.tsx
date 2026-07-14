import React from 'react'

interface GridProps {
  columns?: 1 | 2 | 3 | 4
  gap?: 'sm' | 'md' | 'lg'
  children: React.ReactNode
  className?: string
}

function ResponsiveGrid({ columns = 2, gap = 'md', children, className = '' }: GridProps) {
  const colsMap = {
    1: 'grid-cols-1',
    2: 'md:grid-cols-2',
    3: 'md:grid-cols-3',
    4: 'md:grid-cols-4'
  }

  const gapMap = {
    sm: 'gap-2 md:gap-3',
    md: 'gap-4 md:gap-6',
    lg: 'gap-6 md:gap-8'
  }

  return (
    <div className={`grid grid-cols-1 ${colsMap[columns]} ${gapMap[gap]} ${className}`}>
      {children}
    </div>
  )
}

export default ResponsiveGrid