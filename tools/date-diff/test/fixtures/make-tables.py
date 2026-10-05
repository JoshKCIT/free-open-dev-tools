"""Records the two answer tables the unit tests compare the date calculator with.

Run by hand, never by a test:

    python make-tables.py [output folder]

Standard library only (no packages). Python writes down what its own date arithmetic says:

* business-days.json: for many ranges, weekend sets and holiday lists, a plain day-by-day loop with
  date.isoweekday() counts the business days.
* iso-weeks.json: date.isocalendar() for each year 1900 to 2200 (week count and the Monday that starts week 1),
  for 5,000 seeded dates, for the days around every year end and for a few extreme dates.

The rule for a range whose end is before its start is written here, not borrowed from the code under test: the start day
is always counted, so the days counted run from the day after the end (the end itself when the end is counted) up to and
including the start, and the sign is -1.
"""

import json
import random
import sys
from datetime import date, timedelta
from pathlib import Path

SEED = 20261004
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent
PYTHON = sys.version.split()[0]
RECORDED_ON = date.today().isoformat()

rng = random.Random(SEED)

MIN_ORDINAL = date(1, 1, 1).toordinal()
MAX_ORDINAL = date(9999, 12, 31).toordinal()


def count_business_days(start, end, weekend, holidays, include_end):
    """An independent day-by-day count. Dates are compared as ordinals so 0001 and 9999 never overflow."""
    sign = -1 if end < start else 1
    if end < start:
        # The start day is always counted: from the day after the end (the end itself when counted) up to the start.
        first = end.toordinal() if include_end else end.toordinal() + 1
        last = start.toordinal()
    else:
        first = start.toordinal()
        last = end.toordinal() if include_end else end.toordinal() - 1
    held = {h.toordinal() for h in holidays}
    calendar = weekend_days = skipped = business = 0
    for n in range(first, last + 1):
        calendar += 1
        weekday = date.fromordinal(n).isoweekday()
        if weekday in weekend:
            weekend_days += 1
        elif n in held:
            skipped += 1
        else:
            business += 1
    on_weekend = sum(
        1 for n in held if first <= n <= last and date.fromordinal(n).isoweekday() in weekend
    )
    return {
        "count": business,
        "sign": sign,
        "calendarDays": calendar,
        "weekendDays": weekend_days,
        "holidaysSkipped": skipped,
        "holidaysOnWeekend": on_weekend,
    }


def pick_weekend():
    choice = rng.random()
    if choice < 0.4:
        return [6, 7]
    if choice < 0.5:
        return [5, 6]
    if choice < 0.58:
        return [7]
    if choice < 0.64:
        return []
    size = rng.randint(1, 6)
    return sorted(rng.sample(range(1, 8), size))


def pick_holidays(first_ordinal, last_ordinal):
    low = max(MIN_ORDINAL, min(first_ordinal, last_ordinal) - 40)
    high = min(MAX_ORDINAL, max(first_ordinal, last_ordinal) + 40)
    result = []
    for _ in range(rng.choice([0, 0, 1, 2, 3, 5, 8, 12])):
        result.append(date.fromordinal(rng.randint(low, high)))
    # Boundary holidays, and a repeated one, so the de-duplication and the end rule are exercised.
    if rng.random() < 0.25:
        result.append(date.fromordinal(first_ordinal))
    if rng.random() < 0.25:
        result.append(date.fromordinal(last_ordinal))
    if result and rng.random() < 0.2:
        result.append(rng.choice(result))
    rng.shuffle(result)
    return result


def make_case(start, end, weekend=None, include_end=None):
    weekend = pick_weekend() if weekend is None else weekend
    include_end = rng.random() < 0.5 if include_end is None else include_end
    holidays = pick_holidays(start.toordinal(), end.toordinal())
    row = {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "weekend": weekend,
        "holidays": [h.isoformat() for h in holidays],
        "includeEnd": include_end,
    }
    row.update(count_business_days(start, end, set(weekend), holidays, include_end))
    return row


def random_date(low_year, high_year):
    low = date(low_year, 1, 1).toordinal()
    high = date(high_year, 12, 31).toordinal()
    return date.fromordinal(rng.randint(low, high))


def business_rows():
    rows = []
    # Short ranges in the years people use (about 300 rows).
    for _ in range(300):
        start = random_date(1990, 2040)
        rows.append(make_case(start, start + timedelta(days=rng.randint(0, 120))))
    # Ranges of a few years, anywhere from 1900 to 2200 (about 150 rows).
    for _ in range(150):
        start = random_date(1900, 2200)
        end = start + timedelta(days=rng.randint(121, 7000))
        rows.append(make_case(start, min(end, date(9999, 12, 31))))
    # Start equal to end, on every weekday, with both end rules (about 40 rows).
    anchor = date(2024, 1, 1)
    for offset in range(7):
        day = anchor + timedelta(days=offset)
        for include_end in (False, True):
            rows.append(make_case(day, day, include_end=include_end))
    for _ in range(26):
        day = random_date(1950, 2100)
        rows.append(make_case(day, day))
    # End before the start (about 80 rows).
    for _ in range(80):
        end = random_date(1950, 2100)
        rows.append(make_case(end + timedelta(days=rng.randint(1, 400)), end))
    # The two ends of the calendar and the huge ranges (a handful of rows).
    rows.append(make_case(date(1, 1, 1), date(1, 1, 31), weekend=[6, 7], include_end=True))
    rows.append(make_case(date(1, 1, 1), date(1, 1, 1), weekend=[6, 7], include_end=True))
    rows.append(make_case(date(9999, 12, 1), date(9999, 12, 31), weekend=[6, 7], include_end=True))
    rows.append(make_case(date(9999, 12, 31), date(9999, 12, 31), weekend=[6, 7], include_end=True))
    rows.append(make_case(date(9999, 12, 31), date(9999, 12, 31), weekend=[6, 7], include_end=False))
    rows.append(make_case(date(1, 1, 1), date(9999, 12, 31), weekend=[6, 7], include_end=True))
    rows.append(make_case(date(9999, 12, 31), date(1, 1, 1), weekend=[6, 7], include_end=False))
    rows.append(make_case(date(1600, 1, 1), date(2400, 12, 31), weekend=[5, 6], include_end=False))
    # The worked example of the plan: 2024-01-01 to 2024-01-08 with a holiday on a Saturday.
    example = make_case(date(2024, 1, 1), date(2024, 1, 8), weekend=[6, 7], include_end=False)
    example["holidays"] = ["2024-01-06"]
    example.update(
        count_business_days(date(2024, 1, 1), date(2024, 1, 8), {6, 7}, [date(2024, 1, 6)], False)
    )
    rows.append(example)
    return rows


def iso_year_rows():
    rows = []
    for year in range(1900, 2201):
        year_end = date(year, 12, 28).isocalendar()
        weeks = year_end.week
        monday = date.fromisocalendar(year, 1, 1)
        # Cross-check inside the script: week 53 exists exactly when the year has 53 weeks.
        try:
            date.fromisocalendar(year, 53, 1)
            has_53 = True
        except ValueError:
            has_53 = False
        assert has_53 == (weeks == 53)
        assert year_end.year == year
        assert date(year, 1, 4).isocalendar().week == 1
        rows.append({"year": year, "weeks": weeks, "week1Monday": monday.isoformat()})
    return rows


def week_row(day):
    iso = day.isocalendar()
    return [day.isoformat(), iso.year, iso.week, iso.weekday]


def iso_date_rows():
    low = date(1900, 1, 1).toordinal()
    high = date(2200, 12, 31).toordinal()
    return [week_row(date.fromordinal(rng.randint(low, high))) for _ in range(5000)]


def iso_boundary_rows():
    rows = []
    for year in range(1900, 2201):
        for offset in range(-4, 4):
            rows.append(week_row(date(year, 1, 1) + timedelta(days=offset)))
        for offset in range(-7, 1):
            rows.append(week_row(date(year, 12, 31) + timedelta(days=offset)))
    return rows


def iso_extreme_rows():
    days = [date(1, 1, 1) + timedelta(days=n) for n in range(0, 10)]
    days += [date(9999, 12, 31) - timedelta(days=n) for n in range(0, 10)]
    days += [
        date(100, 3, 1),
        date(400, 12, 31),
        date(1000, 1, 1),
        date(1582, 10, 4),
        date(1582, 10, 15),
        date(1700, 2, 28),
        date(1800, 12, 31),
        date(2000, 2, 29),
        date(2020, 12, 31),
        date(2021, 1, 3),
        date(2024, 12, 30),
        date(2026, 12, 31),
        date(2027, 1, 1),
        date(2100, 3, 1),
        date(2400, 12, 31),
    ]
    return [week_row(day) for day in days]


def write(name, payload):
    path = OUT / name
    path.write_text(json.dumps(payload, indent=1, ensure_ascii=True) + "\n", encoding="utf-8", newline="\n")
    print("wrote", path.name, path.stat().st_size, "bytes")


def main():
    header = {
        "recordedBy": "make-tables.py",
        "python": PYTHON,
        "recordedOn": RECORDED_ON,
        "seed": SEED,
    }
    business = business_rows()
    write(
        "business-days.json",
        {
            **header,
            "rule": (
                "A day-by-day loop over date.toordinal() with date.isoweekday(). The start day is counted, the end "
                "day only when includeEnd is true. A day is a weekend day when its ISO weekday (1 Monday to 7 Sunday) "
                "is in weekend; otherwise it is skipped when it is in holidays; otherwise it is a business day. An "
                "end before the start still counts the start day: the days counted run from the day after the end "
                "(the end itself when includeEnd is true) up to and including the start, and sign is -1."
            ),
            "rows": business,
        },
    )
    write(
        "iso-weeks.json",
        {
            **header,
            "rule": (
                "date.isocalendar() gives the ISO week-numbering year, the week and the weekday. years: each year "
                "1900 to 2200 with date(year, 12, 28).isocalendar().week (the number of weeks in that year) and "
                "date.fromisocalendar(year, 1, 1) (the Monday that starts week 1). dates, boundaries and extremes: "
                "[ISO date, week-numbering year, week, weekday]."
            ),
            "years": iso_year_rows(),
            "dates": iso_date_rows(),
            "boundaries": iso_boundary_rows(),
            "extremes": iso_extreme_rows(),
        },
    )
    print("business rows:", len(business))


if __name__ == "__main__":
    main()
