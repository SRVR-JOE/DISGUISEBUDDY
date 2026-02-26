import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'

interface PageTransitionProps {
  children: React.ReactNode
  viewKey: string
}

const variants = {
  enter: {
    opacity: 0,
    x: 20,
  },
  visible: {
    opacity: 1,
    x: 0,
  },
  exit: {
    opacity: 0,
    x: -20,
  },
}

export function PageTransition({ children, viewKey }: PageTransitionProps) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={viewKey}
        variants={variants}
        initial="enter"
        animate="visible"
        exit="exit"
        transition={{ duration: 0.2, ease: 'easeInOut' }}
        // Ensure the wrapper fills its parent so page content flows correctly
        className="h-full"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
