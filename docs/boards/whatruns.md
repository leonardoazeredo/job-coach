# WhatRuns jobs search

Observed 2026-10-27. The page and its filter controls were read from the DOM and network log of a logged-out browser session. The API behaviour was tested with plain `curl`. Nothing here needs an account.

The board's own wording is "Ashby Jobs"; it aggregates 126,786 listings from ten applicant tracking systems.

The counts below were measured with London and UK filters. They show how each filter behaves, not what to search for: the adapter takes its locations from `discovery.search` in `profile/search.yaml`.

## The search API

`GET https://jobs.whatrunsindia.com/api/jobs?<query>` is the single endpoint behind the page. The page URL carries the same query parameters (`/?location=...&tags=...`), and the front end just forwards them. Response:

```
{ "data": [ ...cards ], "total": 126786, "page": 1, "totalPages": 3170 }
```

There is no login gate and no page limit: page 3170 returned the last 26 rows, and page 3171 returned an empty list. Page size is 40 by default.

## Filters

| Filter (UI control) | Parameter | Accepted values | Combining several |
| --- | --- | --- | --- |
| Search box ("Search skills, titles, companies...") | `search` | Free text over titles, skills and companies. `search=frontend` returned 2,568. Parameters named `q`, `query`, `keyword` and `title` are ignored. | Not a list. A phrase narrows (`frontend engineer`: 2,734); `frontend OR react` works as an OR (4,159); `frontend,react` behaves as an AND-ish narrowing (96). |
| Location (checkbox list) | `location` | A value from the site's own location list (about 10,850 entries: cities, countries, regions, street addresses, and emoji-flag variants such as `🇬🇧 London`). Matching is exact on the whole value but not case-sensitive (`london` works). Any value not in the list gets `400 {"error":"Invalid location filter"}`: `Lond`, `Greater London`, `Remote`, `Remote UK` all failed. | Comma-separated, OR. `London,Berlin` returned 3,659 against 2,514 for London. A repeated `location=` parameter is not combined. |
| Remote (REMOTE button) | `remote` | `true`. The value `false` is the same as no filter. | n/a |
| Tags (select, 54 values) | `tags` | `ai`, `airflow`, `angular`, `aws`, `azure`, `backend`, `data`, `devops`, `django`, `docker`, `elixir`, `embedded`, `entry level`, `fastapi`, `frontend`, `full stack`, `fullstack`, `gcp`, `golang`, `graphql`, `intern`, `java`, `javascript`, `junior`, `kafka`, `kotlin`, `kubernetes`, `llm`, `mobile`, `new grad`, `next.js`, `node`, `php`, `postgres`, `python`, `pytorch`, `qa`, `rails`, `react`, `ruby`, `rust`, `scala`, `security`, `snowflake`, `software engineer`, `solidity`, `spark`, `spring boot`, `svelte`, `tensorflow`, `terraform`, `typescript`, `vue`, `web3`. | Comma-separated, AND. `react,typescript` returned 1,672 against 2,646 for `react`. |
| Employment type (select) | `employmentType` | `FullTime`, `Intern`, `Contract`, `PartTime`. | One value only. `FullTime,Contract` is ignored. Most listings have no type (the unfiltered `FullTime` count is 28,547 of 126,786). |
| Experience (select) | `exp` | `1` (fresher or new grad), `2` (1–2 years), `5` (3–5 years). Other values are ignored. | One value. See the note below. |
| Provider (multi-checkbox) | `source` | `ashby`, `greenhouse`, `keka`, `lever`, `pinpoint`, `recruitee`, `smartrecruiters`, `teamtailor`, `workable`, `workday`. | Comma-separated, OR (`ashby,lever`: 35,041). |
| Department (multi-checkbox, 17) | `department` | `Customer Success & Support`, `Data & AI`, `Design`, `Engineering`, `Finance`, `Hardware & Manufacturing`, `Healthcare`, `IT`, `Legal & Compliance`, `Marketing`, `Operations`, `Other`, `People & HR`, `Product`, `Research & Science`, `Sales`, `Security`. | Comma-separated, OR (`Engineering,Product`: 24,315). |
| Company (select, about 3,960 slugs) | `company` | The company slug as listed, case-insensitive (for example `ravenmoor`). | One value. |
| Sort (select) | `sort` | `score` (UI default; the API default is also score order), `newest`, `oldest`. | n/a |
| Page size | `limit` | Any number up to 100; larger values are capped at 100. `pageSize` and `perPage` are ignored. | n/a |
| Page | `page` | 1 upwards. | n/a |

Not available: seniority, salary, currency, posted date, visa, timezone. `minSalary`, `salary`, `days`, `since` and similar guesses were ignored.

### Notes on specific filters

- **Locations are not hierarchical.** `United Kingdom` (809), `UK` (5), `London` (2,514), `Europe` (139), `EMEA` (71), `Worldwide` (27) and `Anywhere` (13) are separate values with separate listings; a London role is not found under `United Kingdom`. To cover the UK, request several values at once. `Worldwide` and `Anywhere` are the nearest to worldwide remote, and they are small. The `remote` flag is separate again: `remote=true&location=London` gave 887 of London's 2,514.
- **Location list.** The list has no endpoint of its own (`/api/locations` and similar return 404). It is embedded in the page and shown as checkboxes under "All locations", with a search box. A value copied from there, including any emoji prefix, is accepted.
- **Commas.** Because lists are comma-separated, a location whose own name contains a comma cannot be requested.
- **`exp` is a cap, not a band.** The counts rise with the number (`1`: 68,988; `2`: 74,038; `5`: 109,387), and `5` still leaves 80% of listings, so it reads as "needs at most this much experience". There is no way to ask for senior roles. Seniority has to come from the title or `search`.
- **`sort=score` hides unscored rows.** It returned 100,843 of 126,786. The default order is score as well, with a relevance score from the site's keyword list (`matchedKeywords`); `newest` gives true date order but includes scoreless listings.
- **Sort and filter order.** `sort=newest` puts today's listings first even in London; `oldest` begins in 2017.

## Example requests

The values are illustrative; substitute the search terms and locations from your own `profile/search.yaml`.

Backend-flavoured search in one city or its region, newest first, 100 a page:

```
curl -s -G https://jobs.whatrunsindia.com/api/jobs \
  --data-urlencode 'search=backend' \
  --data-urlencode 'location=Berlin,Europe' \
  --data-urlencode 'sort=newest' \
  --data-urlencode 'limit=100' \
  --data-urlencode 'page=1'
```

Python and Postgres tags in Europe and EMEA, Engineering department, Ashby or Greenhouse:

```
location=Europe,EMEA&tags=python,postgres&department=Engineering&source=ashby,greenhouse&remote=true
```

Page URL form: `https://jobs.whatrunsindia.com/?location=%F0%9F%87%A9%F0%9F%87%AA+Berlin&tags=python&employmentType=FullTime&exp=5&sort=newest&remote=true&source=ashby&department=Customer+Success+%26+Support`.

## Result fields

`id`, `jobId`, `company`, `source` (the applicant tracking system: `ashby`, `greenhouse`, `teamtailor`, and so on), `title`, `location`, `team`, `department`, `employmentType`, `remote`, `applyUrl`, `jobUrl`, `publishedAt`, `scrapedAt`, `createdAt`, `updatedAt`, `isActive`, `score`, `matchedKeywords`, `contentHash`, `description` (empty in every row sampled), and pay: `compensationSummary` (for example `£100K – £130K • Offers Equity`), `compensationMin`, `compensationMax`, `compensationCurrency`, `compensationInterval`.

Data quality in a 300-row London sample: 41 had pay; 222 were flagged remote; 264 came from Ashby; the employment type was `FullTime` for 260 but also appeared as `Permanent`, `fulltime_permanent`, `Full-time`, `Permanent - Full Time` and null (24). Department was null for 25.

## Access, limits and reliability

- Plain HTTP is enough: no cookies, tokens or special headers. The site sits behind Cloudflare, and `/api/jobs` is served with `cache-control: public, s-maxage=3600`, so results can be up to an hour old.
- Twenty parallel requests all returned 200. Responses took 0.4 to 0.9 seconds. No rate limiting was seen.
- Our adapter's note about occasional HTML or connection failures was not reproduced in this session, so keep the retry.
- The `/api/auth/session` call on page load is the sign-in check and is not needed for search. The applied, ignored and match pages need an account and were not explored.

## Differs from our adapter

- **The one-location-at-a-time assumption is wrong.** `location` takes a comma-separated list, so the adapter's loop over `discovery.search` city, country and regions can be one request per page set. The values must be exact list entries: `London`, `United Kingdom`, `Europe` and `EMEA` are valid, but `Remote` or `Greater London` would be rejected with a 400, so check your own values against the site's list.
- **It pulls everything.** The adapter sends no `search`, `tags`, `remote`, `employmentType` or `source`, so it pages through every listing for each location (63 pages of 40 for London alone, as measured). At `limit=100` the same London pull is 26 requests; `search` and `tags` narrow it further. The adapter's comment that the API filters by location only is out of date.
- **No use of `limit`.** 100 a page cuts the page count by 60%.
- **Seniority and salary still cannot be filtered** on this board, so they are left to the shortlist. Today only `compensationSummary` reaches it, as the string `pay`. A salary check in code would need the adapter to read `compensationMin`, `compensationMax` and `compensationCurrency`, the listing to carry them, and the shortlist to test them.
- The adapter uses the default order (score). A pull that wants the newest roles should pass `sort=newest`.

## Recommendation

Direct HTTP is enough; Playwright is not needed. Build tier searches as `search` plus `tags` plus a comma list of locations, with `remote=true` where it applies, `limit=100` and a page loop on `totalPages`. Filtering by title and level still happens after the pull. Validate location values against the site's list, because an invalid one fails the whole request.
