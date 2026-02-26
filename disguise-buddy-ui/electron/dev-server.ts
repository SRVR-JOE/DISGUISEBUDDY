import { startApiServer } from './api-server.js'

startApiServer().then(() => {
  console.log('Dev API server running on http://localhost:47100')
  console.log('Press Ctrl+C to stop')
})
