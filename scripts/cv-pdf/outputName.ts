/** File name for an exported CV, derived from the CV's own name so no person's name is baked into the tooling. */
export function outputName(cv: { name: string }): string {
  const slug = cv.name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug ? `${slug}-CV.pdf` : 'cv.pdf'
}
