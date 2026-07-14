import express, { Express, Request, Response } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { createServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import dotenv from 'dotenv'
import authRoutes from './routes/auth'
import projectRoutes from './routes/projects'
import aiRoutes from './routes/ai'

dotenv.config()

const app: Express = express()
const httpServer = createServer(app)
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.VITE_API_URL || 'http://localhost:5173',
    methods: ['GET', 'POST']
  }
})

const PORT = process.env.PORT || 3000

// Middleware
app.use(helmet())
app.use(cors())
app.use(express.json())

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
})
app.use(limiter)

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/projects', projectRoutes)
app.use('/api/ai', aiRoutes)

app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'GenityNexys server is running' })
})

// WebSocket events
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`)

  socket.on('join-project', (projectId: string) => {
    socket.join(`project:${projectId}`)
    socket.to(`project:${projectId}`).emit('user-joined', { userId: socket.id })
  })

  socket.on('code-change', (data: { projectId: string; code: string }) => {
    io.to(`project:${data.projectId}`).emit('code-updated', { code: data.code })
  })

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`)
  })
})

httpServer.listen(PORT, () => {
  console.log(`🚀 GenityNexys server running on http://localhost:${PORT}`)
  console.log(`✨ Nexus AI engine ready`)
  console.log(`🌐 WebSocket server ready on ws://localhost:${PORT}`)
})

export { app, io }