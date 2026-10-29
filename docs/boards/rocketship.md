# Remote Rocketship search (UK site)

Observed 2026-10-27 in a logged-out browser session and with plain `curl`. Nothing here needs an account, except the paging limit described below.

The counts below were measured on the UK site with UK and London filters. They show how each filter behaves, not what to search for: the adapter takes its titles from `discovery.search_titles` and `discovery.title_expansion`, and its locations, seniority, stack, employment type and hybrid switch from `discovery.search`, all in `profile/search.yaml`.

## Two ways in

The page `https://www.remoterocketship.com/gb/remote-jobs/` is a Next.js page. The same search is reachable three ways:

| Route | Used by | Notes |
| --- | --- | --- |
| `GET /_next/data/<buildId>/gb/remote-jobs.json?<query>` | our adapter | Needs the rotating build id, read from the HTML (`"buildId":"..."`). Query parameters as in the URL table below. Returns `pageProps.initialJobOpenings` and `pageProps.initialTotalJobCount`. |
| `POST /api/fetch_job_openings/` | the site's own filter UI | No build id. JSON body. Returns `{ jobOpenings, totalCount }`. This is the better route for a pull. |
| Page URL `/gb/remote-jobs/?<query>` | people | Same query parameters as the first route. |

### Paging is gated behind login

Logged out, only page 1 is served, at 20 results.

- `POST /api/fetch_job_openings/` with `page` of 2 or more, or `itemsPerPage` above 20, answers `401 {"message":"You must be logged in to access more results."}`.
- The `_next/data` route answers 200 for any `page` but repeats page 1 (confirmed: pages 1, 2 and 3 returned the same first slugs). That is why the adapter stops on a repeated page.

So one query yields at most the 20 newest (or highest-paid) matches. A tier search has to be narrow enough that its top 20 is the whole answer, or it has to be split into several narrower queries.

## Filter controls in the UI

Job Title, Location (multi), Minimum Salary, Experience (multi), Is on LinkedIn?, Ghost jobs, Keywords, Hide (excluded keywords), Visa sponsorship, Company Size, Employment Type, Tech Stack, Degree required?, Industry, Exclude Industry, Languages I speak, the Remote only / Hybrid / Onsite switch, and a sort selector (Date Added, Highest Salary). Saved searches and email alerts need an account.

## Filters at API level

POST body, with the fields the site sends. Every field below can be omitted; a body of `{"showRemoteJobs":true,"page":1,"itemsPerPage":20,"sortBy":"DateAdded","language":"gb"}` plus the filters you want works.

| Filter | Body field | Page-URL parameter | Accepted values | Combining several |
| --- | --- | --- | --- | --- |
| Job title | `jobTitleFilters: string[]` | `jobTitle` | Category titles such as `Frontend Engineer`, `Product Engineer`, `Frontend Developer`. Matching is not case-blind: `frontend engineer` returned 18 against 49 for `Frontend Engineer`. A title with no matches returns `totalCount: 0`. | OR. `["Frontend Engineer","Product Engineer"]` returned 99, which is 49 + 50. In the URL, comma-separated. |
| Keywords | `keywordFilters: string[]` | `keywords` | Free text, for example `react` (209), `frontend` (145). | OR (`["react","typescript"]` returned 314, more than either). |
| Excluded keywords | `excludedKeywordFilters: string[]` | `excludedKeywords` | Free text. `senior` removed about 70% of UK remote. | n/a |
| Country or region | `locationFilters: string[]` | `locations` | Country names (`United Kingdom`, `Germany`, `Ireland`, `United States`) and `Europe`. `Worldwide` selects the worldwide-remote set (1,474). | OR. `["United Kingdom","Germany"]` returned 18,775. |
| City | `locationCityFilters: string[]` | `locationCity` | `London`. See the oddity below. | OR with the country filter, not an AND. |
| Work mode | `showRemoteJobs`, `showHybridJobs`, `showOnsiteJobs` (booleans) | `showHybridJobs=true`, `showOnsiteJobs=true` (remote is on by default) | Each switch adds that mode. Remote off with hybrid on gave hybrid only (UK: 14,540; London: 7,516). Onsite is reported as `locationType: "office"`. | Additive. |
| Seniority | `seniorityFilters: string[]` | `seniority` | `entry-level`, `junior`, `mid-level`, `senior`, `expert` (the UI's "Leadership positions"). `lead` and other unknown values are ignored and return everything. | OR. `senior,expert` returned 9,174 against 8,122 for `senior`. |
| Tech stack | `techStackFilters: string[]` | `techStack` | Canonical, case-sensitive names: `React`, `TypeScript`, `JavaScript`, `.NET`, `AWS`, and so on. `react` or an unknown name is silently ignored and returns everything. | OR. `["React","TypeScript"]` returned 498 against 302 for React alone. It is a wide net, not a requirement. |
| Employment type | `employmentTypeFilters: string[]` | `employmentType` | `full-time`, `part-time`, `contract` (UI: Contract/Temporary), `internship`. Only `full-time` and `contract` were confirmed from the UI or responses. | OR assumed, not tested. |
| Minimum salary | `minSalaryFilter: number`, `showJobsWithoutSalaryWithMinSalaryFilter: boolean` | `minSalary` | A number in US dollars per year. The UI's "£90k/year" sends `118000`. It is tested against the top of the range converted to USD (`maxSalaryAsUSD`), so a role paying £69k–£93k (US$94k–127k) passes a 100000 filter. | n/a |
| Visa | `visaFilter: string` | `visas` | `uk-skilled-worker` confirmed from the UI. The UI also has an H1B (US only) option, presumably `h1b`. | Single value. |
| Ghost jobs | `hideGhostJobsFilter` | `hideGhostJobs` | The string `"true"` hides high ghost-score roles (10,844 to 10,301). The boolean `true` does nothing. | n/a |
| On LinkedIn | `isOnLinkedInFilter: boolean \| null` | not checked | `false` should give "not on LinkedIn"; not tested. | n/a |
| Required languages | `requiredLanguagesFilters: string[]` | not checked | ISO codes: `de` returned 75. | not tested |
| Company size, industry, degree | `companySizeFilters`, `industriesFilters`, `excludeIndustriesFilters`, `degreeRequiredFilter` | not checked | Not explored. | |
| Sort | `sortBy` | `sort` | `DateAdded` (default), `Salary` (UI "Highest Salary"). | n/a |
| Page | `page`, `itemsPerPage` | `page` | 1 and 20 only when logged out. | n/a |

Also in the body: `language` (`gb` for this site), and several lists of saved, applied or hidden ids that stay empty for a logged-out search.

### Worldwide remote

`locationFilters: ["United Kingdom"]` already includes the worldwide-remote set: the count with and without `"Worldwide"` added is the same (10,844). An unknown location name (`Zzzland`, `EMEA`, `Remote - Europe`) falls back to the worldwide set alone (1,474). So worldwide roles come with any location search, and `EMEA` is not a region the site knows.

`Europe` is a real region value (35,026 results) but is broad. Adding `United Kingdom` to it gives 35,908, so the UK adds roughly 880 roles that `Europe` does not already cover.

### City filter oddity

`locationCityFilters: ["Manchester"]` with the default UK filter returned 113,571, far more than the whole UK set. Treat the city filter as unreliable for remote searches. With hybrid on and remote off, `["London"]` behaved sensibly (7,516 London hybrid roles).

## Salary and seniority in results

Salary is filterable (above) and sortable. `salaryRange` is `null` for most roles; with a salary filter and `showJobsWithoutSalaryWithMinSalaryFilter: false`, the UK pool at US$100,000 was 940 roles, and 1 for the title Frontend Engineer.

Seniority comes back as five booleans (`isEntryLevel`, `isJunior`, `isMidLevel`, `isSenior`, `isLead`), and a role can carry more than one. Filtering on `senior` returns roles flagged mid-level and senior together.

## Example requests

The values are illustrative; substitute the titles, country and stack from your own `profile/search.yaml`.

Two titles, one country, senior and leadership, full-time, newest first:

```
curl -s -X POST https://www.remoterocketship.com/api/fetch_job_openings/ \
  -H 'content-type: application/json' \
  -d '{"jobTitleFilters":["Backend Engineer","Data Engineer"],
       "locationFilters":["Germany"],
       "seniorityFilters":["senior","expert"],
       "techStackFilters":["Python","Go"],
       "employmentTypeFilters":["full-time"],
       "showRemoteJobs":true,"showHybridJobs":true,
       "page":1,"itemsPerPage":20,"sortBy":"DateAdded","language":"gb"}'
```

Salary floor of US$100,000, hybrid and remote, sorted by pay:

```
{"locationFilters":["Germany"],"showRemoteJobs":true,"showHybridJobs":true,
 "minSalaryFilter":100000,"showJobsWithoutSalaryWithMinSalaryFilter":false,
 "sortBy":"Salary","page":1,"itemsPerPage":20,"language":"gb"}
```

The same search on the page-data route: `/_next/data/<buildId>/gb/remote-jobs.json?page=1&sort=DateAdded&locations=Germany&seniority=senior,expert&techStack=Python,Go&jobTitle=Backend+Engineer,Data+Engineer&minSalary=100000`.

## Result fields

Per role: `id`, `roleTitle`, `slug`, `url` (the employer's apply page, often a Workday or other ATS address, with no ATS name field), `created_at`, `validUntilDate`, `company` (`name`, `slug`, `homePageURL`, `employeeRange`, `sponsorsUKSkilledWorkerVisa`, `sponsorsH1B`, `fundingData`), `locationType` (`remote`, `hybrid`, `office`), `location`, `locationCountries`, `locationCity`, `employmentType`, `salaryRange` (`min`, `max`, `currencyCode`, `salaryType`, `minSalaryAsUSD`, `maxSalaryAsUSD`, `salaryHumanReadableText`), the seniority booleans, `techStack`, `requiredLanguages`, `jobDescriptionSummary`, `twoLineJobDescriptionSummary`, `categorizedJobTitle`, `categorizedJobFunction`, `ghostScore` and `ghostSignals`, `isOnLinkedIn`, `scoringKeywords`. Translations of the summaries sit in `*Brazil`, `*France`, `*Germany` fields.

## Access, limits and reliability

- Plain HTTP is enough. A bare `curl` with only `content-type: application/json` got 200 from the POST route, with no cookies, CSRF token, or special user agent. A minimal body works.
- The `_next/data` route needs the build id, which changes on deploys; the POST route does not.
- Twenty parallel requests from one address all returned 200, in under a second. No rate limit was seen. Responses took 0.4 to 0.9 seconds.
- Silent no-ops are the main hazard: an unknown tech stack, seniority, location or visa value filters nothing instead of failing.
- Counts drift by one or two between calls as listings arrive (10,843 against 10,844).

## Differs from our adapter

- The adapter pulls the `_next/data` route with one title per query and loops titles. The POST route takes all titles in one query, so a tier's titles can share one request and one 20-result window.
- The adapter sends `seniority`, `employmentType` and `showHybridJobs` from `discovery.search`; the site's seniority values are `senior` and `expert`, not `lead`.
- The adapter does not send a salary floor. `minSalary` is available and is in US dollars, so a floor in another currency must be converted, and it tests the top of the range.
- The adapter sends `discovery.search.country` as `locations`, which already covers worldwide remote. It sends `discovery.search.city` as `locationCity`, and that parameter behaves oddly (above); consider dropping it for remote searches.
- The adapter's `techStack` is an OR, so several names widen the result rather than requiring any one of them. Names are case-sensitive.
- The adapter cannot use `sort=Salary` today, but the site supports it.
- The adapter's repeated-page stop is correct. Only 20 results per query are reachable logged out.

## Recommendation

Direct HTTP is enough; a Playwright script adds nothing. Use `POST /api/fetch_job_openings/` rather than `_next/data`: no build id to scrape, several titles per request, and every filter above in one body. Design tier searches as several narrow queries (one seniority band, one title group, a salary floor) because each returns only 20 roles.
