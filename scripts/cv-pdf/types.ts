export interface Job {
  id: string
  role: string
  company: string
  location?: string | undefined
  /** "April 2026" style. Kept as free text so you can write "Present". */
  start: string
  end: string
  note?: string | undefined
  tech?: string[] | undefined
  bullets: string[]
}

export interface Education {
  id: string
  degree: string
  institution: string
  location?: string | undefined
  /** "April 2026" style. Kept as free text so you can write "Present". */
  start: string
  end: string
}

export interface CvData {
  name: string
  headline: string
  location: string
  email: string
  phone: string
  linkedin: string
  github: string
  summary: string
  skills: string[]
  work: Job[]
  training: string[]
  projects: string[]
  education: Education[]
  languages: string[]
}
