import { z } from 'zod'

const EnvSchema = z.object({
  VITE_API_BASE_URL: z.url().default('http://localhost:8080'),
})

const env = EnvSchema.parse(import.meta.env)

export const API_BASE_URL = env.VITE_API_BASE_URL
