// Section and RESULT formatting is pinned exactly by structureChecks.test.ts.
// The RESULT line is also matched by cli.test.ts and badPdfs.test.ts, so keep
// its wording stable.
export function section(n: number, title: string): string {
  return `\n  [${n}] ${title}`
}

export function formatResult(failures: number): string {
  return `\n  RESULT: ${failures === 0 ? 'PASS' : `${failures} failing check(s)`}`
}
