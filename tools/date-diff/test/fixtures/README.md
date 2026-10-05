# Fixtures: what Python answered

The unit tests for business days and ISO week dates compare this package with Python's own date arithmetic without ever
running Python. Python was run once, by hand, and its answers are stored here. The script that made them is
`make-tables.py` in this folder (standard library only, a fixed seed); no test runs it.

| File                 | What it holds                                                                                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make-tables.py`     | The script. Run by hand: `python make-tables.py [output folder]`.                                                                                                                                                                                                                                                   |
| `business-days.json` | 579 ranges, each with a weekend set (default Saturday and Sunday, Friday and Saturday, Sunday only, none, or a random set of one to six days), a holiday list (up to 15 dates, some repeated, some on the first or last day, some on weekend days, some outside the range), the end rule, and the count Python got. |
| `iso-weeks.json`     | `date.isocalendar()` for each year 1900 to 2200 (the week count and the Monday that starts week 1), for 5,000 seeded dates from 1900 to 2200, for the 8 days around every 1 January and the 8 days up to every 31 December, and for 35 extreme dates (the first and last ten days of the calendar, and others).     |

- **Python version:** 3.14.3 (`python` in each file's header), run from a scratch virtual environment with no packages.
- **Recorded on:** 2026-10-04 (`recordedOn`).
- **Seed:** 20261004 (`seed`), used with `random.Random`.

## How business days were counted

A plain loop over `date.toordinal()` from the first day to the last day. A day is a weekend day when
`date.isoweekday()` (1 Monday to 7 Sunday) is in the weekend set; otherwise it is skipped when it is one of the holidays;
otherwise it is a business day. The start day is counted; the end day only when the end rule says so. An end before the
start still counts the start day: the days counted run from the day after the end (the end itself when the end rule says
so) up to and including the start, and the sign is -1. Each row also records the calendar days in the range, the weekend days, the different holidays that took a
business day away (`holidaysSkipped`) and the different holidays that fell on a weekend day (`holidaysOnWeekend`).

## How ISO weeks were recorded

- `years`: `weeks` is `date(year, 12, 28).isocalendar().week` (28 December is always in the last week of its year), and
  `week1Monday` is `date.fromisocalendar(year, 1, 1)`. The script also checks, for each year, that
  `date.fromisocalendar(year, 53, 1)` works exactly when the year has 53 weeks and that 4 January is in week 1.
- `dates`, `boundaries`, `extremes`: `[ISO date, week-numbering year, week, weekday]` from `date.isocalendar()`.

## Browsers

The browser's own `Temporal` is the second opinion for ISO weeks and durations. It is not available in Node 22, so it
is used in `e2e/dev-oracles.spec.ts`, not here.

## Making the tables again

```
python -m venv <scratch folder>/venv-16
<scratch folder>/venv-16/Scripts/python make-tables.py
```

The files are plain JSON written with one-space indentation. They are kept as written (no formatter is run over them).
