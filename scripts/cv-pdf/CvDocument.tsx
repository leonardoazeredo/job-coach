import type { CSSProperties } from 'react'
import { type FitResult, fitVars } from './fit.ts'
import type { CvData } from './types.ts'

/**
 * The CV document. This is the single source of truth for every output:
 * the live preview, the print layout, and the PDF (Chrome prints the app
 * itself).
 *
 * Structure matters as much as content here. See cv.css for why.
 */
export function CvDocument({ data, fit }: { data: CvData; fit?: FitResult | null }) {
  const summary = data.summary.trim()

  return (
    <article
      className="cv"
      lang="en"
      style={fit ? (fitVars(fit.level) as CSSProperties) : undefined}
      data-fit-pages={fit?.pages}
      data-fit-level={fit?.index}
    >
      <header className="cv-header">
        <h1 className="cv-name">{data.name}</h1>
        {data.headline ? <p className="cv-headline">{data.headline}</p> : null}
        <div className="cv-contact">
          {data.location ? <div>{data.location}</div> : null}
          {data.email ? <div>Email: {data.email}</div> : null}
          {data.phone ? <div>Phone: {data.phone}</div> : null}
          {data.linkedin ? (
            <div>
              LinkedIn: <a href={`https://${data.linkedin}`}>{data.linkedin}</a>
            </div>
          ) : null}
          {data.github ? (
            <div>
              GitHub: <a href={`https://${data.github}`}>{data.github}</a>
            </div>
          ) : null}
        </div>
      </header>

      {summary ? (
        <section className="cv-section">
          <h2>PROFESSIONAL SUMMARY</h2>
          <p>{summary}</p>
        </section>
      ) : null}

      {data.skills.length > 0 ? (
        <section className="cv-section">
          <h2>CORE SKILLS</h2>
          {/* comma separated so multi-word skills ("React Native") stay one
					    phrase in the text layer */}
          <p className="cv-skills">{data.skills.join(', ')}</p>
        </section>
      ) : null}

      {data.work.length > 0 ? (
        <section className="cv-section">
          <h2>WORK EXPERIENCE</h2>
          {data.work.map((job) => {
            const line = [job.company, job.location].filter(Boolean).join(', ')
            const dates = [job.start, job.end].filter(Boolean).join(' - ')
            return (
              <article className="job" key={job.id}>
                <div className="job-role">{job.role}</div>
                <div className="job-line">
                  {line} <span className="job-dates">| {dates}</span>
                  {job.note ? <span className="job-dates"> ({job.note})</span> : null}
                </div>
                {job.tech?.length && job.tech?.length > 0 ? (
                  <div className="job-tech">Technologies: {job.tech?.join(', ')}</div>
                ) : null}
                {job.bullets.length > 0 ? (
                  <ul>
                    {job.bullets.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            )
          })}
        </section>
      ) : null}

      {data.training.length > 0 ? (
        <section className="cv-section">
          <h2>TRAINING</h2>
          <ul className="cv-list">
            {data.training.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.projects.length > 0 ? (
        <section className="cv-section">
          <h2>PROJECTS</h2>
          <ul className="cv-list">
            {data.projects.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.education?.length > 0 ? (
        <section className="cv-section">
          <h2>EDUCATION</h2>
          {data.education?.map((ed) => {
            const line = [ed.institution, ed.location].filter(Boolean).join(', ')
            const dates = [ed.start, ed.end].filter(Boolean).join(' - ')
            return (
              <article className="job" key={ed.id}>
                <div className="job-role">{ed.degree}</div>
                <div className="edu-line">
                  {line} <span className="job-dates">| {dates}</span>
                </div>
              </article>
            )
          })}
        </section>
      ) : null}

      {data.languages.length > 0 ? (
        <section className="cv-section">
          <h2>LANGUAGES</h2>
          <p>{data.languages.join(', ')}</p>
        </section>
      ) : null}
    </article>
  )
}
