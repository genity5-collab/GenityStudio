import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'

const router = Router()

interface Project {
  id: string
  name: string
  code: string
  createdAt: string
  updatedAt: string
  userId: string
}

// Mock database
const projects: Map<string, Project> = new Map()

router.get('/', (req: Request, res: Response) => {
  try {
    const projectList = Array.from(projects.values())
    res.json(projectList)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch projects' })
  }
})

router.post('/', (req: Request, res: Response) => {
  try {
    const { name, code = '', userId } = req.body

    if (!name) {
      return res.status(400).json({ error: 'Project name is required' })
    }

    const project: Project = {
      id: uuidv4(),
      name,
      code,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      userId: userId || 'anonymous'
    }

    projects.set(project.id, project)
    res.status(201).json(project)
  } catch (error) {
    res.status(500).json({ error: 'Failed to create project' })
  }
})

router.get('/:id', (req: Request, res: Response) => {
  try {
    const project = projects.get(req.params.id)

    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }

    res.json(project)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch project' })
  }
})

router.put('/:id', (req: Request, res: Response) => {
  try {
    const project = projects.get(req.params.id)

    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const { name, code } = req.body

    if (name) project.name = name
    if (code !== undefined) project.code = code
    project.updatedAt = new Date().toISOString()

    projects.set(project.id, project)
    res.json(project)
  } catch (error) {
    res.status(500).json({ error: 'Failed to update project' })
  }
})

router.delete('/:id', (req: Request, res: Response) => {
  try {
    if (projects.has(req.params.id)) {
      projects.delete(req.params.id)
      res.json({ message: 'Project deleted' })
    } else {
      res.status(404).json({ error: 'Project not found' })
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete project' })
  }
})

export default router