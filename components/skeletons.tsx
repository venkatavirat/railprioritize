'use client'

import { motion } from 'framer-motion'

export function SkeletonCard() {
  return (
    <motion.div
      className="bg-slate-200 rounded-lg"
      animate={{ opacity: [0.6, 1, 0.6] }}
      transition={{ duration: 1.5, repeat: Infinity }}
    />
  )
}

export function SkeletonMetric() {
  return (
    <div className="space-y-3">
      <SkeletonCard />
      <div className="h-8 bg-slate-200 rounded-lg animate-pulse" />
      <div className="h-4 bg-slate-200 rounded-lg animate-pulse w-2/3" />
    </div>
  )
}

export function SkeletonTable() {
  return (
    <div className="space-y-4">
      {[...Array(5)].map((_, i) => (
        <motion.div
          key={i}
          className="h-12 bg-slate-200 rounded-lg"
          animate={{ opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.1 }}
        />
      ))}
    </div>
  )
}

export function SkeletonChart() {
  return (
    <div className="space-y-2">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="flex gap-2 items-center">
          <motion.div
            className="h-6 bg-slate-200 rounded-lg flex-1"
            animate={{ opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.1 }}
          />
          <div className="w-12 h-6 bg-slate-200 rounded-lg" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonMetricGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => (
        <SkeletonMetric key={i} />
      ))}
    </div>
  )
}
