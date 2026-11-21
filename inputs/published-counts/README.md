# Published motor traffic counts

This folder holds motor traffic counts that public bodies have published for streets in the study area. The study area runs from Paddington to Holborn: longitude -0.185 to -0.11, latitude 51.505 to 51.53. The Department for Transport (DfT) count points are kept elsewhere in `inputs/dft/`. The counts here add streets that DfT does not count.

Every figure in `counts.csv` was checked by hand against its source document or data file.

## The two files

`counts.csv` lists the counts the study uses. There is one row per count site, with the latest usable survey of that site.

`other-figures.csv` lists figures that do not meet the rules below but that bear on streets the study's routes or the council's plans use. They are kept for reference. The study does not use them.

## What counts as usable

A figure goes into `counts.csv` only if all of these hold:

1. It is an observed count of all motor vehicles. Automatic counters, manual or video counts and number-plate cameras qualify. Model outputs do not. Figures worked out by subtraction or inference do not.
2. It covers at least 12 hours of one day, or is an average of such days. Peak-hour counts do not qualify.
3. The survey took place in 2016 or later.
4. The source itself names the street. A site whose street can only be found by laying a map over another map does not qualify.
5. The site lies inside the study area.
6. The source was published by a public body, or a public body published the document, and it can be found today at a web address. An address in the Internet Archive's Wayback Machine is accepted.
7. It covers the whole carriageway. A count of one direction of a two-way street does not qualify.

If a survey was disturbed by roadworks or diversions, an undisturbed survey of the same site is used instead when one qualifies. Otherwise the disturbed survey is kept and the note says so.

## Columns of counts.csv

| Column | Meaning |
|---|---|
| `id` | Short stable id. The prefix names the source: `tfl-`, `camden-wep-`, `camden-tor-`, `wcc-soho-`. |
| `street` | The street name exactly as in the study's OpenStreetMap network, `data/lts/today-ways.geojson`. |
| `section` | Where on the street the count was taken, in the source's words where it gives them. |
| `lon`, `lat` | A point on the named street at the counted section (WGS84, 5 decimals). Each point lies within 15 m of a way with that name. Where the source gives coordinates they were used, moved onto the street if needed. Otherwise the point comes from the source's site map or from the street geometry of the described section. The note says which. |
| `carriageway` | `two-way` if the street is two-way at the site and the count covers both directions, `one-way` if the street is one-way there. |
| `all_motor_vehicles` | The number counted over the counted hours, as published. It is not expanded to 24 hours. |
| `hours` | How many hours of the day the count covers: 12, 16 or 24. |
| `year`, `survey_date` | Year and date or date range of the survey (ISO dates, `/` between the first and last day). |
| `method` | How the count was made. |
| `publisher`, `document`, `url`, `page` | Where the figure was found. `page` gives the page, table or figure, or the file and field names in a dataset. |
| `licence` | The terms the source is published under, as the source states them. |
| `note` | Direction split, earlier surveys of the same site, disturbances and anything else a reader needs. |

A 12- or 16-hour count leaves out the night. Treat it as a lower bound for the daily flow.

## Columns of other-figures.csv

`street`, `section`, `figure` (as the source states it, never converted to a daily flow), `unit`, `year`, `kind` (`peak-hour count`, `modelled`, `count before 2016`, `short count`, `one direction only`, `inferred`), `why_not_used`, `publisher`, `document`, `url`, `page`, and `checked` (`yes` if the figure was read again in the source for this file, `no` if not).

The modelled flows of the London Atmospheric Emissions Inventory are not listed here. The study handles that dataset separately.

## Sources

### Transport for London, Active Travel Counts Programme

- Publisher: Transport for London (TfL).
- Data: count files and `1 Monitoring locations.csv` at https://cycling.data.tfl.gov.uk/ActiveTravelCountsProgramme/ (release note: `0 Strategic active travel counts - release note.pdf`, January 2024).
- What it is: TfL's cycle count programmes. At a subset of sites TfL also counted all motor vehicles by type. These sites were counted on one weekday per survey wave, 06:00 to 22:00, in 15-minute intervals. Some 2021 counts ran for 24 hours. The 2022 files use 30-minute intervals. Where a wave has two weekday rounds, the row gives their mean.
- Used here: 63 sites, surveys from 2017 to 2023. Two other sites are left out because a later count at the same place is in the Camden rows.
- Licence: the files carry no licence statement. TfL publishes its open data under its Transport Data Service licence, which is based on the Open Government Licence v2.0 and asks for the attribution "Powered by TfL Open Data" (https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service).

### London Borough of Camden, West End Project Final Monitoring Report

- Title: West End Project Final Monitoring Report. Prepared by AECOM for the London Borough of Camden, May 2022 (revision of July 2022). Published as Appendix E to Camden's West End Project 12-month monitoring decision, August 2022.
- Address: https://web.archive.org/web/20240925022020/https://democracy.camden.gov.uk/documents/s105697/Appendix%20E%20-%20AECOM%20-%20Final%20West%20End%20Project%20Monitoring%20Report.pdf%20 (the council's own address now refuses automated clients).
- What it is: automatic traffic counters around Tottenham Court Road in March 2017 (14 days), July and September 2021, and 26 February to 18 March 2022 (21 days). Appendix A gives the average 24-hour flow for weekdays, Saturdays and Sundays by direction. The rows use the weekday average. The report also gives 12-hour baseline counts from one day, 16 May 2017 (Table 2-1).
- Used here: 20 counters that the report names, and 3 of the 2017 12-hour counts. Counters the report shows only on its map, without naming the street, are not used.
- Licence: none stated. The figures are quoted with a citation.

### London Borough of Camden, Torrington Place / Tavistock Place monitoring report

- Title: Appendix E, Monitoring Report v4.0, Torrington Place / Tavistock Place Corridor Scheme. Prepared by London Borough of Camden officers, August 2018.
- Address: https://web.archive.org/web/20240717115452/https://democracy.camden.gov.uk/documents/s71615/Appendix%20E%20Monitoring%20Report%20v4.0.pdf
- What it is: manual classified counts, 07:00 to 19:00, on Wednesday 23 May 2018 (Tables 2.1 and 2.2).
- Used here: 7 street sections in Bloomsbury. Woburn Place south is left out because its printed total (8,582) does not equal the sum of its two directions (11,053). Tavistock Place is left out because TfL counted the same section in 2023.
- Licence: none stated. The figures are quoted with a citation.

### Westminster City Council, Soho Monitoring Study

- Title: Soho Monitoring Study: Traffic and Movement Analysis Addendum. Prepared by Waterman Infrastructure & Environment for Westminster City Council, September 2024 (document WIE20033-102-R-1-1-1-AD). The companion Traffic and Movement Initial Report (WIE20033-102-R-1-3-3-RP) describes the cameras.
- Addresses: https://www.westminster.gov.uk/sites/default/files/media/documents/traffic-and-movement-addendum-report.pdf and https://www.westminster.gov.uk/sites/default/files/media/documents/traffic-and-movement-initial-report.pdf, both listed at https://www.westminster.gov.uk/soho-monitoring-study.
- What it is: number-plate cameras at every entry to and exit from Soho over a whole day. The rows use Wednesday 3 July 2024, which the council added as a check on the March 2024 survey. The March survey was disturbed by roadworks and camera faults, and the consultant adjusted its figures.
- Used here: 5 entry points on one-way streets. Three values are stated in the text. Two were read off a bar chart. The entries at Great Marlborough Street and Manette Street are in `other-figures.csv`, because both streets are two-way there and the cameras give one direction only.
- Licence: no open licence. Westminster's website terms say its material may not be republished without permission. The figures are quoted with a citation.

### Sources of other-figures.csv

- Transport for London, "Traffic impacts of the pedestrianisation of Oxford Street", consultation factsheet, November 2025, https://haveyoursay.tfl.gov.uk/45256/widgets/136421/documents/95830/download. Banded peak-hour flows from TfL's ONE model for 2026. No licence stated.
- AECOM for Transport for London, "Environmental impacts of the pedestrianisation of Oxford Street West", November 2025, https://haveyoursay.tfl.gov.uk/45256/widgets/136421/documents/95831/download. 10-minute counts at noise monitoring sites, June 2025. No licence stated.
- Transport assessments on Westminster's planning register (https://idoxpa.westminster.gov.uk): 16/06423/FULL (Steer Davies Gleave, June 2016), 11/01182/FULL (Motion, February 2011), 13/04844/FULL (Steer Davies Gleave, June 2013) and 19/08460/FULL (Velocity Transport Planning, October 2019). Peak-hour and older counts. No licence stated.
- Westminster City Council with TfL and New West End Company, "Brook Street and Davies Street proposed changes to traffic movements, parking and loading", exhibition board, 2016, https://www.westminstertransportationservices.co.uk/projects/project_details.php?id=441.
- Publica and WSP for Westminster City Council, Soho Public Realm Study, April 2014, https://www.westminster.gov.uk/sites/default/files/media/documents/Soho.Public.Realm_.Study_.pdf.
- Norman Rourke Pryme for Westminster City Council, Baker Street Two Way, Post Scheme Implementation Analysis, 2020, https://web.archive.org/web/20210113145943/http://bakerstreettwoway.co.uk/pdfs/traffic-monitoring-report.pdf.
- TfL Active Travel Counts Programme, counts from 2014 and 2015 at two of the sites used.

The Westminster documents fall under Westminster's website terms described above.

## Known weaknesses

- Most counts cover a single day. One weekday can differ from a typical day by 10 to 20 percent or more.
- The TfL counts and the 2017 and 2018 Camden counts cover 16 or 12 hours, not the whole day. They are recorded as counted. They understate the daily flow, more so on streets with heavy evening traffic.
- Many counts are from 2017 to 2019. Several streets have changed since then. Tottenham Court Road, Gower Street and Bloomsbury Street became two-way. Gloucester Place became two-way. Camden filtered several Fitzrovia streets. Newman Street and Berners Street changed direction. The notes flag these where known.
- Counts from October 2021 come after the pandemic restrictions ended but may still be a little below normal traffic.
- Two Soho values were read off a bar chart, to about plus or minus 25 vehicles. The listed vehicle classes do not include motorcycles.
- For counters that the Camden report shows on a map, the position along the street was read from that map and may be out by about 20 m. The street itself is named in the report.
- Two Camden counters were disturbed in March 2022 by diversions. Their undisturbed March 2017 surveys are used, which predate the West End Project.
