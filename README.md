# Main Street Agent

## 1. Get it into GitHub (GitHub Desktop)

1. Unzip `main-street-agent.zip`. You get a folder named `main-street-agent` that is already a Git repository on branch `main` with no commits yet.
2. Open **GitHub Desktop → File → Add local repository…**, choose the `main-street-agent` folder and click **Add repository**. You do not need the "create a repository" step.
3. Type the commit Summary `Initial commit` and click **Commit to main**.
4. Click **Publish repository**, leave **Keep this code private** ticked, and click **Publish repository**.
5. On GitHub, open the repo's **Settings → Advanced Security** (under "Security and quality"), enable **Secret Protection**, then click **Enable** next to **Push protection**. For private repositories this may depend on your GitHub plan; if the option isn't there, GitHub's pricing page will say what's needed.

## 2. Deploy on Vercel

1. In Vercel, click **Add New… → Project**, import the private `main-street-agent` repo and click **Deploy**. No build settings are needed: it is static files plus one function in `api/`.
2. Open **Project → Settings → Environment Variables** and add `ANTHROPIC_API_KEY` for **Production** (value from the Claude Console, see below). Optionally add `ANTHROPIC_MODEL`. For the Dollar tracker, also add `FRED_API_KEY` (free, recommended) and, if you want the electricity card, `EIA_API_KEY` (free).
3. Redeploy (**Deployments → ⋯ → Redeploy**) so the function picks up the key. The chat cannot answer until this is done; until then it shows a friendly "not set up yet" message.
4. Add the rate-limit rule in **Firewall** (fields below).

### The API key

- Create a **dedicated workspace for this project** in the Claude Console, set a **monthly spend limit** and **spend alerts**, and create the key inside that workspace. One leaked or abused key can then only spend what that workspace allows.
- Use that key for **Production** only. Give Preview/Development a separate low-limit key, or none.
- The key lives only in Vercel's environment variables (and your own `.env.local` if you run it locally). It is never in the HTML, browser JavaScript or this repo.

### Firewall rate limit

| Field | Value |
| --- | --- |
| Name | Rate limit chat API |
| If | Request Path equals `/api/chat` |
| Rate limit | Fixed Window, 600 seconds, 20 requests, key IP Address |
| Then | Too Many Requests (429) |

These numbers match the in-code limiter in `api/_lib/guard.js`. The in-code one is per server instance, so the Firewall rule is the real enforcement.

Optional second rule for the Dollar tracker's data endpoint: Name "Rate limit dollar API", path `/api/dollar`, Fixed Window 600 seconds, 30 requests, key IP Address, Then Too Many Requests (429). This matches the in-code limiter in `api/dollar.js`. That endpoint spends no Anthropic credit, so this rule only protects the free data sources.

### Free data keys for the Dollar tracker

FRED's API terms require two things on the site, and both are already in the footer of the engine page and the Dollar tracker: the notice "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis." and a link to the FRED® API Terms of Use stating that users agree to be bound by them. Keep both if you edit the footers. Don't use the FRED name or St. Louis Fed logo in your domain or branding, or suggest the site is endorsed by them.


- **FRED_API_KEY** (recommended): create a free account at fred.stlouisfed.org, then go to **My Account → API Keys → Request API Key**. Without it, the tracker falls back to FRED's public CSV download.
- **EIA_API_KEY** (optional): register at eia.gov/opendata. Without it, the electricity card is hidden.
- The U.S. Treasury data and the gold price need no key.

---

## What it is

One guide and one chat engine covering everyday money and small business, built from the Banking, Business, Finance, Marketing, Jack Ma and Alex Hormozi source folders.

- **`/`** is the engine. Describe what you need in your own words. It asks one question at a time, then shows a top match, a shortlist and a clear next step. Type a ZIP code and it lists FDIC-insured bank branches near you from the FDIC's public data.
- **`/guide`** is the guide (GUB): 112 topics in ten sections. Every topic links to its sources.
- **`/dollar`** is the Dollar tracker: where the dollar stands right now. It shows the dollar measured in gold (the headline metric), inflation and purchasing power, the money supply, Fed and Treasury rates, real yields, the national debt and its daily growth, interest payments, the average rate on the debt, debt compared with GDP, the dollar index, real GDP alongside GDI, and, with an EIA key, electricity generation. Every card shows its date and links to its official source. The page also offers The Dollar Brief as a PDF download (`assets/the-dollar-brief.pdf`).

| Section | Examples |
| --- | --- |
| Start a business | Entity types, forming an LLC, Arizona specifics, DBAs, EINs, registered agents, business banking, self-employment taxes, nonprofits beside an LLC, buying a business |
| Grow and scale | Finding the bottleneck, eight recorded turnaround case studies, pricing and offers, getting customers, speed to lead, retention, AI-era advice, Zero to One |
| Marketing and sales | The Free Loop, honest messaging, landing-page patterns, marketing rules (FTC, CAN-SPAM, TCPA), personal brand, outreach, affiliates, memberships |
| Bank accounts | Opening checking, Bank On, big-bank and online accounts, credit unions, finding banks by ZIP, second chances |
| Save, invest and family money | Savings, CDs, sudden money, gifting rules, building assets |
| Where the dollar stands | The live tracker, reserve currency, nominal vs. real, gold as a yardstick, bonds and yields, the national debt and interest, CPI, how GDP is measured, electricity, stablecoins and the GENIUS Act, post-WWII financial repression, I Bonds and TIPS |
| Deposits and moving money | Check holds, pending balances, overdrafts, PayPal/Wise and international transfers |
| Money stories and lessons | The 2008 crisis, leverage and margin calls, Soros, famous traders, Jack Ma, creator income vs ownership |
| Find real help | Advisors, credit counseling, housing counselors, free tax help, SCORE/SBDC, CFPB complaints |
| Protect yourself | "The dollar is collapsing" pitches, put options risk, money mules, fake clients and overpayments, straw borrowers, income claims, gold IRAs, AI trading claims, subscription funnels, fake official notices |

Both pages read the same content file, `data/gub.json`.

## How it works

```
index.html, assets/engine.*      → engine (home page)
guide/index.html, assets/guide.* → guide, rendered from data/gub.json
dollar/index.html, assets/dollar.* → Dollar tracker page
assets/prefs.js                  → theme toggle + text size (saved as pref-theme / pref-font-size)
api/chat.js                      → chat function (POST /api/chat)
api/dollar.js                    → live dollar data (POST /api/dollar), read-only
api/_lib/dollar-data.js          → fetches and caches the dollar figures (not a route)
api/_lib/guard.js                → origin check, rate limit, body size limit (not a route)
data/gub.json                    → all guide content; also read by api/chat.js
vercel.json                      → security headers, CSP, function settings
```

**Engine flow.** The browser sends the conversation to `/api/chat`. The function scores `data/gub.json` entries against what the person typed and passes the eight most relevant to Claude as reference data. If the person typed a 5-digit ZIP, it also looks up FDIC-insured branches from `api.fdic.gov`. When the conversation is about the dollar, prices, gold, rates, the debt or the economy, the function also adds today's tracker figures (with dates and sources), so the chat can quote live numbers. Claude answers in plain text and ends recommendations with `MATCH:` lines, which the page strips from the visible reply and uses to fill the Top match, Shortlist and Listing details cards.

**Editing content.** Change `data/gub.json` and redeploy. Each entry has `id`, `category`, `kind`, `title`, `summary`, `body`, `steps`, `tags`, `details`, `next_step` and `sources`. Tags drive which entries the engine sees, so add the words people actually type.

**Dollar tracker data.** `api/_lib/dollar-data.js` pulls from the U.S. Treasury's Fiscal Data API (debt to the penny, average interest rates), FRED (series DGS3MO, DGS10, DGS30, DFII10, DFF, DTWEXBGS, CPIAUCSL, CPILFESL, CUUR0000SA0R, M2SL, A191RL1Q225SBEA, A261RL1Q225SBEA, GFDEGDQ188S, A091RC1Q027SBEA, POPTHM), gold-api.com for spot gold and, optionally, the EIA. Results are cached for 15 minutes per server instance and for 5 minutes in the visitor's tab. If one source is down, its cards are left out and the page says which figures are missing. The "dollar measured in gold" card compares today's price with rounded annual average gold prices for 2000, 2014 and 2020 (`GOLD_REFERENCE` in that file). Check those against gold.org if you need exact figures.

**What works today:** the guide, the chat (once the key is set), the Dollar tracker (Treasury and gold need no key; FRED works without a key through its CSV download, but a key is recommended), ZIP-based FDIC branch lookup, voice input (where the browser supports it), the theme and text-size settings, and full-page chat.

**What would need a bigger build:** historical charts of gold (the free gold feed gives only the current price), alerts when a number crosses a level, filing LLC or nonprofit paperwork, opening accounts, live rates and fees, credit union lookup by ZIP (the NCUA has no simple public API; the engine links to its locator), saved chat history or accounts, and sending email or booking appointments. The engine takes no real-world actions.

## Security

- The browser only ever calls `/api/chat`, never `api.anthropic.com`. All model and user text is inserted with `textContent`.
- `/api/dollar` accepts only `POST` with a JSON body, checks the Origin, has its own rate limit (30 per 10 minutes per visitor), times out after 20 seconds and returns only public figures. It never takes actions or calls Anthropic.
- `/api/chat` accepts only `POST` with a JSON body up to 32 KB, at most 24 messages, typed messages up to 2,000 characters (earlier replies sent back as context are trimmed to 8,000), and only `user`/`assistant` roles. The page drops the oldest turns if a long conversation would pass 32 KB. The server alone sets the model, `max_tokens` and the system prompt.
- Requests whose `Origin` is not the site's own domain get a 403. This stops other websites from using the chat from a visitor's browser. It does **not** stop scripts, which is why the rate limit and the spend cap matter.
- Upstream calls time out after 25 seconds (the function's limit is 30). Errors return a plain message; logs contain status codes only.
- `vercel.json` sets `nosniff`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` (microphone for this site only, for voice input), HSTS and a Content-Security-Policy that allows only this site plus Google Fonts. The small inline theme script is allowed by its SHA-256 hash.
- There are no dependencies, so there is nothing to `npm install` or audit.

If you change the inline `<script>` in the `<head>` of either page, its hash changes and you must update the `sha256-…` value in `vercel.json`, or the theme won't restore before first paint.

## Run locally (optional)

```
npm i -g vercel
vercel dev
```

Put `ANTHROPIC_API_KEY=…` in `.env.local` (git-ignored) first.

## Content notes

- Facts were checked on 2026-10-07 (banking topics), 2026-10-15 (business, marketing and lessons) and 2026-10-16 (the dollar section) against official or primary sources listed in each entry: the IRS, FinCEN rulings as reported by law firms, the FTC, FCC, FDIC, CFPB, SBA, the Arizona Secretary of State, Chase.com and others.
- Some fees could not be re-opened live on 2026-10-15 (Arizona Corporation Commission filing fees, Chase business fees beyond the screenshots, registered-agent pricing). Those topics tell readers to confirm the current fee with the source.
- Case studies come from recorded shows and are labeled as reported results, not independently audited.
- No personal names, emails, account details or transactions from the source folders appear in the guide, apart from the site owner's own contact line in the footer.
