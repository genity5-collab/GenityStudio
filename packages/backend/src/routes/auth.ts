import { Router, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'

const router = Router()

interface User {
  id: string
  email: string
  name: string
}

// Mock database
const users: Map<string, { email: string; password: string; name: string }> = new Map()

const generateToken = (user: User) => {
  return jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: process.env.JWT_EXPIRY || '7d' }
  )
}

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    if (users.has(email)) {
      return res.status(409).json({ error: 'Email already exists' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const userId = `user_${Date.now()}`

    users.set(email, { email, password: hashedPassword, name })

    const user: User = { id: userId, email, name }
    const token = generateToken(user)

    res.json({ user, token })
  } catch (error) {
    res.status(500).json({ error: 'Registration failed' })
  }
})

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Missing credentials' })
    }

    const user = users.get(email)
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const isValid = await bcrypt.compare(password, user.password)
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const userId = `user_${Date.now()}`
    const userData: User = { id: userId, email, name: user.name }
    const token = generateToken(userData)

    res.json({ user: userData, token })
  } catch (error) {
    res.status(500).json({ error: 'Login failed' })
  }
})

export default router