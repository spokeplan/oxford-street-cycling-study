# Notes behind the article

The article gives the main figures and a short table of checks. This page holds the rest: every check, the assumptions, the limits and the unrounded figures street by street. For the full grading rules and code layout, see [lts.md](lts.md); for the press-ready maps, see [figures/README.md](../figures/README.md).

**Contents:** [Every check](#every-check) · [The two readings, street by street](#the-two-readings-street-by-street) · [Where the evidence is thinnest](#where-the-evidence-is-thinnest) · [Sources and assumptions](#sources-and-assumptions) · [What the model cannot tell you](#what-the-model-cannot-tell-you) · [The longer trip](#the-longer-trip) · [Unrounded figures](#unrounded-figures)

**Terms.** A street with no traffic figure has neither a count nor a modelled flow. For those streets the study puts in a figure of its own, twice. The busy guess does not count such a street as calm and is the main reading. The quiet guess gives it the traffic of a quiet side street and is the quiet reading. The grading on both guesses is mapped in [stress-map-readings.png](../figures/stress-map-readings.png).

## Every check

The study has two findings: that no calm route exists, and how much street it would take to make one. They are not equally firm. Every row below was run on the same streets (raw tables: [robustness.csv](../results/lts/sensitivity/best-evidence/robustness.csv) and [runs.csv](../results/lts/sensitivity/best-evidence/runs.csv)). The first row is the article's main reading. Each figure is for the smaller of the two routes, first on the busy guess and then on the quiet guess.

| Reading | Calm route? | Street to convert, busy guess / quiet guess |
|---|---|---|
| Main reading | No | 1.9 / 1.3 km |
| Guesses only, without the counts I found or the modelled flows | No | 1.9 / 1.1 km |
| Counts and guesses, without the modelled flows | No | 1.9 / 1.2 km |
| Modelled flows halved | No | 1.8 / 1.2 km |
| Modelled flows doubled | No | 1.9 / 1.3 km |
| The Department for Transport's limit, 2,500 vehicles a day at 20 mph, in place of the American table | No | 1.5 / 1.2 km |
| 20 mph streets read in the table's 20 mph column, not its 25 mph column | No | 1.3 / 1.2 km |
| Side streets with no lane data treated as having no centre line | No | 1.4 km on the busy guess, the only one run |
| Residential and minor streets with no traffic figure at 750 vehicles a day | No | 1.3 km on both guesses |
| Every street with no traffic figure carrying no traffic at all | No | 1.3 km |
| Counts only, and every other street carrying no traffic at all | No | about 150 m, mostly crossings |
| Bikes let back through the pedestrian zone on a track | No | 1.7 / 1.3 km |
| The whole of Oxford Street closed to cycling, a possible extension | No | 1.9 / 1.4 km |
| Converted one-way streets stay one-way for bikes | No | 2.4 / 1.8 km |
| The 2012 grading, which ignores traffic volume | Yes | none |

Two things follow. The finding that no calm route exists is not a product of one table, one guess or one source of data: every reading that takes traffic into account agrees. The length is softer. It stays between 1.1 and 2.4 km in every such row of the table but one, and that one shows what the length leans on. With counts only, and every other street taken as empty, about 150 m is left. Everything above that comes from Transport for London's modelled flows and from my guesses.

## The two readings, street by street

On the main reading there is little calm network to join up, and each route is close to one continuous line. In the north it stays close to the line the route planners already use. It starts with about 170 m of Oxford Street's western end, Portman Street and Portman Square, then takes about 600 m of Wigmore Street, Cavendish Square, Cavendish Place and Mortimer Street, and ends with the open stretch of Oxford Street's eastern end. That is 2.1 km of a ride of 2.6 km. In the south it runs from Park Lane along Upper Brook Street, Brook Street, Great Marlborough Street and Noel Street to Soho Square, 1.9 km of a ride of 2.5 km.

On the quiet guess, much of Marylebone, Fitzrovia and Mayfair is calm already, and the work is joining it up. In the north that would mean Great Cumberland Place, Seymour Street, Portman Square and Fitzhardinge Street at the western end, short links through Marylebone and Fitzrovia, then Wells Street, Newman Street, a stretch of Oxford Street's eastern end and Soho Street. The route it opens is about 3 km long, at the quarter-longer limit. In the south it would mean about 270 m of Park Lane, then Davies Street, Maddox Street, Great Marlborough Street and Noel Street, for a route of 2.8 to 2.9 km.

The counts I found moved the lower figures. On guesses alone, with every back street taken as quiet, the northern route looked the smaller job, at 1.1 km against 1.3 km. It relied on Great Cumberland Place, Fitzhardinge Street and Welbeck Street being calm. Transport for London counted all three in 2017, the latest counts I found, and each was well over the calm line.

I also tested a protected track along the whole of Wigmore Street, the main road one block north, where both planners I tried already send cyclists. It would not finish the job. Another 1.5 km of street would still need converting, or 1.1 km on the quiet guess.

I also tested letting bikes back through the pedestrian zone on a marked cycle track, and counted the track as street to convert, since it would have to be built. The track alone is not enough, because the zone is only the central stretch and both ends of the street still carry motor traffic. With the track, the total comes to about 1.7 km, or 1.3 km on the quiet guess. About 1.1 km of the 1.7 km is on Oxford Street itself, counting the track and the ends of the street that are still open to traffic. That is about 200 m less street than the southern route round the zone, and it is on the direct line.

## Where the evidence is thinnest

The two routes rest on different kinds of evidence ([headline-streets.csv](../results/lts/sensitivity/best-evidence/headline-streets.csv)). The northern route leans on counts: about 1.9 km of its 2.1 km has a count on the street or carried along the same road, with more than half on three streets carrying a Department for Transport count (Wigmore Street, Mortimer Street and Oxford Street). The southern route leans on Transport for London's model: about 1.6 km of its 1.9 km takes its traffic figure from that model, and only about 100 m from a count.

Great Marlborough Street and Noel Street, in Soho, matter most. Across all 32 search runs ([frequency.csv](../results/lts/sensitivity/best-evidence/frequency.csv)), they come up most often after a 48 m stretch of Carlisle Street next to Soho Square (31 of 32 runs), appearing in 27 of the 32 runs each. Neither has a usable count. Westminster surveyed Soho with number-plate cameras in 2024, but the published figures give only one direction of Great Marlborough Street. Transport for London's model puts the stretches to convert at about 3,800 to 6,800 vehicles a day on Great Marlborough Street and about 3,100 to 8,100 on Noel Street. Where it can be checked against counts on back streets, that model runs about a quarter high, and sometimes far more. A count below the calm line would take either street off the list.

Automatic traffic counters on those two streets for a week would test the core of the southern route. Westminster may hold some of this already. [Its 2023 business case for the Oxford Street programme](https://committees.westminster.gov.uk/ieDecisionDetails.aspx?AIId=19196) lists baseline traffic surveys for September 2022 and a report on them for December 2023, and I found no published results. If they exist, they would say more about these streets than my model can.

## Sources and assumptions

Everything except SpokePlan's own routes linked in the article can be rerun from this repository. The street map is an OpenStreetMap extract of 7 November 2026, which is what "today" means on this page. The traffic counts are the Department for Transport's [road traffic statistics](https://roadtraffic.dft.gov.uk/), Transport for London's [count programme](https://cycling.data.tfl.gov.uk/), two monitoring reports by Camden Council and Westminster's [Soho Monitoring Study](https://www.westminster.gov.uk/soho-monitoring-study), each matched to streets. From the last three I took counts made in 2016 or later that cover at least 12 hours. The 12- and 16-hour counts are used as they stand, which understates the day. The modelled flows are from the [London Atmospheric Emissions Inventory 2022](https://data.london.gov.uk/dataset/london-atmospheric-emissions-inventory-laei-2022-2lg5g). They come from Transport for London's traffic model, which has 2019 as its base year, so they predate the change that made part of Wigmore Street two-way and the ban itself. The grading is Peter Furth's 2017 table. Valhalla is the independent routing engine. The search for the streets to convert is my own code, and it is in the repository.

For streets with no traffic figure, the busy guess puts 2,500 vehicles a day on residential streets, 3,000 on other minor streets and 6,000 on local through streets. The quiet guess puts 1,000, 1,500 and 3,000. I also tried to sort those streets by whether a driver crossing the area could use them as a short cut. Checked against the counted streets, that test did no better than treating every one as busy, so I did not use it.

The counts favour the busy guess, so it is my main reading. At 86 places where a side street has been counted, 63 were over the calm line. At the 54 of those that Transport for London's model leaves out, 33 were. Berwick Street, a one-way street in Soho, carried about 2,400 vehicles a day in 2024. Conway Street, in Fitzrovia, carried about 400 in 2022. Counters tend to go where traffic is expected, so side streets in general may be quieter than the counted ones. That is why I also show the quiet guess, as the least the answer could be.

Three choices in the main reading err towards more stress. The table goes by the speed traffic actually moves at. I have only the posted limit, and I assumed traffic runs a little above it, so I read London's 20 mph streets in the table's 25 mph column rather than its 20 mph one. The table grades a street with a centre line as more stressful than one without, and where OpenStreetMap does not say, I assumed a centre line. I graded painted cycle lanes as mixed traffic, which is what the table advises where lanes are often blocked. In the search for a cautious rider's least stressful line, a metre of stressful street counts as four metres of calm street.

I assume a converted one-way street can be ridden both ways, on a two-way track or a contraflow lane. National guidance presumes in favour of cycling both ways on one-way streets unless safety, operational or cost reasons rule it out (Local Transport Note 1/20, paragraph 6.4.21). The table of checks above shows the totals without that assumption.

I ran the search 32 times: with the streets that have no traffic figure taken as quiet or busy, on four street layouts, with bikes kept out of the pedestrian zone or let back in, and with or without two-way cycling on converted one-way streets. The four layouts are today's streets, today's with a Wigmore Street track, and two with the whole of Oxford Street closed to cycling, one of which also closes the three short links that cross the closed carriageway. That closure is my assumption, not a published plan. It is based on City Hall's 2025 commission for a design covering the whole street. For the table of the two routes I also ran the search kept to one side of Oxford Street at a time.

Great Chapel Street, in Soho, is graded traffic-free. OpenStreetMap shows it open to motor traffic, but [Westminster's project page for the street](https://www.westminstertransportationservices.co.uk/projects/project_details.php?id=627) says it has been traffic-free since the pandemic, and the works to make that permanent are due to finish in December 2026.

## What the model cannot tell you

- This is one trip, the length of Oxford Street and back, with each end placed on the nearest calm street. Other trips across the West End will have other answers.
- The quarter-longer test is measured against the shortest ride after the ban, so an acceptable route can be up to 45 per cent longer than the old ride along Oxford Street.
- Metres converted are not a measure of cost. A metre of Cavendish Square is not a metre of side street.
- The grading scores streets, not junctions. A crossing of Park Lane counts only for its length.
- The modelled flows are Transport for London's estimates, not counts. Against the Department for Transport's counts, which are mostly on main roads, they run about a quarter low. Against the counts I found on back streets they run about a quarter high.
- Most of the counts I found cover a single day.
- All of this is worked out from open data. People who ride these streets every day will know things the map and the counts do not.
- Neither authority uses this grading. Transport for London assesses new routes with its own Cycle Route Quality Criteria, and Westminster says it follows national cycling design guidance. I used the American table because it is published, based on traffic volume and reproducible.

## The longer trip

The article's map of a longer trip, from Hammersmith to Russell Square, shows two routes from SpokePlan, saved in [`inputs/spokeplan-routes/`](../inputs/spokeplan-routes/README.md) as returned on 16 November 2026: its Road preset (8,629 m) and its City preset (9,997 m), each with the preset's default speed and mass and no via points. The same two routes are saved as share links, [Road](https://spokeplan.com/s/nlBYhXsMFadl) and [City](https://spokeplan.com/s/MjMjUSIACIpF). About 1.4 km of the Road route is on the southern route's streets to convert (Brook Street 452 m, Upper Brook Street 324 m, Great Marlborough Street 291 m, Grosvenor Square 165 m, Hanover Street 74 m, Hanover Square 64 m and two short crossings). The City route follows Rotten Row, Constitution Hill, Birdcage Walk, Great George Street and Bridge Street to the Victoria Embankment, which it follows for about 1.1 km before turning north through Covent Garden. Matched to the OpenStreetMap extract, the City route from the point where the two part in Hyde Park is 6.0 km, of which 81% is on cycleways and shared-use paths (66% cycle-only track, 15% shared path), and its stretch from Constitution Hill to the end of the Victoria Embankment is about 3.0 km of separated track. The Road route from Upper Brook Street to Poland Street is 1.6 km, of which 89% has no cycle track or lane. The exceptions are a 120 m track on Hanover Street and short lanes on Hanover Square and Regent Street. They are one planner's routes and cannot be rerun from this repository. Valhalla does not reproduce either, and the article does not show its route. At every setting of `use_roads` from 0 to 1, with a road or a hybrid bike, it crosses the West End on Piccadilly and Shaftesbury Avenue, in 7.9 to 8.3 km. Valhalla works from road type and cycle infrastructure tags and has no traffic volumes. The Department for Transport counted 46,143 motor vehicles a day on Piccadilly between Hyde Park Corner and St James's Street in 2025, and 15,133 on Shaftesbury Avenue in 2023. Those routes are in `results/long-trip/`, and `scripts/long-trip/run.ts` reruns them against a running Valhalla container for today's streets. They start and end about 10 m from the points of the two saved routes.

## Unrounded figures

These are the unrounded model outputs, for checking against the result files. The article quotes them rounded. The street-by-street parts are rounded to the metre and may not sum exactly.

- Street to convert for both directions today, with two-way cycling allowed on converted one-way streets: northern route 1,301 m on the quiet guess and 2,142 m on the busy guess, southern route 1,359 m and 1,878 m. With a Wigmore Street track, the smaller of the two routes: 1,078 m and 1,465 m.
- The northern 1,301 m, west to east: crossings at Marble Arch 14 m, Great Cumberland Place 102 m, Seymour Street 67 m, Portman Square 153 m, Fitzhardinge Street 122 m, Welbeck Street 43 m, Hallam Street 73 m, crossing at Langham Street 5 m, Great Portland Street 91 m, Riding House Street 122 m, Wells Street 145 m, Eastcastle Street 40 m, Newman Street 126 m, Oxford Street 125 m, Soho Street 73 m.
- The southern 1,359 m, west to east: Park Lane 273 m, Grosvenor Gate 47 m, crossings at Mount Street, Carlos Place and Bourdon Street 51 m, Davies Street 172 m, Grosvenor Street 44 m, Maddox Street 279 m, Great Marlborough Street 310 m, Noel Street 134 m, Carlisle Street 48 m.
- The northern 2,142 m, west to east: Portman Street 152 m, Portman Square 151 m, Wigmore Street 609 m, Cavendish Square 111 m, Cavendish Place 114 m, Mortimer Street 264 m, Wells Street 46 m, crossings at Wells Mews and Berners Street 23 m, Eastcastle Street 40 m, Berners Street 114 m, Wardour Street 75 m, Oxford Street 296 m, Soho Street 73 m, Soho Square 75 m.
- The southern 1,878 m, west to east: crossings at Park Lane and Brook Gate 97 m, Upper Brook Street 324 m, Grosvenor Square 157 m, Brook Street 461 m, Hanover Square 65 m, Hanover Street 57 m, Maddox Street 69 m, Great Marlborough Street 310 m, Noel Street 134 m, Carlisle Street 48 m, Soho Square 155 m.
- On guesses alone, without the counts I found or the modelled flows: northern route 1,113 m and 2,149 m, southern route 1,298 m and 1,940 m.
- Street to convert for one direction only, today, same condition: 923 m to 1,823 m.
- Carlisle Street is in 31 of the 32 runs, Great Marlborough Street and Noel Street are in 27, and no street is in all 32.
- Calm route for a cautious rider today, with a Wigmore Street track, or with the whole of Oxford Street closed to cycling: none on the 2017 grading.
- Confident rider's detour on OpenStreetMap: 329 m eastbound and 213 m westbound, 52 and 36 seconds at Valhalla's speed.
- Motor vehicles a day at the latest Department for Transport count: Wigmore Street 15,534 (2019), Mortimer Street 8,139 (2025), Oxford Street 6,552 to 10,867 at four counted points (2016 to 2025).
- Motor vehicles in the counts I found: New Cavendish Street 9,098 in 16 hours (2017), Great Cumberland Place 7,825 in 16 hours (2017), George Street 5,756 in a day (2021), Welbeck Street 4,579 in 16 hours (2017), Fitzhardinge Street 3,849 in 16 hours (2017), Wardour Street 2,846 in a day (2024), Newman Street 1,505 in 16 hours (2023), Conway Street 415 a day (2022).
