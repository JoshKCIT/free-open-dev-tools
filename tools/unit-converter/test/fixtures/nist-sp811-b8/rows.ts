/*
 * The NIST SP 811 Appendix B.8 rows used as the cross-check of the unit factors (P13-08: the expected values are the
 * published ones, never this folder's own output).
 *
 * Source: https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b8
 * fetched 2026-10-02. NIST publications are works of the U.S. government (see UPSTREAM.md). Each row below was read out
 * of the saved page by a script (kept in the session scratch directory): `printed` and `exponent` are the two cells
 * "Multiply by" holds, with the digits grouped as NIST prints them, and `bold` is whether NIST prints them in
 * boldface, which the page says means the factor is exact ("A factor in boldface is exact. All other factors have been
 * rounded to the significant digits given", Appendix B.2). `from` and `to` are the unit symbols or names the unit
 * converter accepts for the two NIST units.
 *
 * Nothing in this file was typed by hand except the `from` and `to` pairing of each row.
 */

export interface NistRow {
  quantity: string;
  /** The unit typed for the first column of the row. */
  from: string;
  /** The unit typed for the second column of the row. */
  to: string;
  nistFrom: string;
  nistTo: string;
  /** The mantissa as NIST prints it, digits grouped by spaces. */
  printed: string;
  /** The exponent as NIST prints it, such as E-02. */
  exponent: string;
  /** NIST prints the factor in boldface, so it is exact. */
  bold: boolean;
}

export interface ExactNote {
  /** quantity:symbol of a unit whose factor is exact although NIST prints the B.8 row rounded. */
  unit: string;
  source: string;
  /** Text found in the saved source, with white space collapsed. */
  quote: string;
}

export const NIST_B8_URL =
  'https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b8';

export const NIST_ROWS: NistRow[] = [
  {
    "quantity": "length",
    "from": "in",
    "to": "m",
    "nistFrom": "inch (in)",
    "nistTo": "meter (m)",
    "printed": "2.54",
    "exponent": "E-02",
    "bold": true
  },
  {
    "quantity": "length",
    "from": "in",
    "to": "cm",
    "nistFrom": "inch (in)",
    "nistTo": "centimeter (cm)",
    "printed": "2.54",
    "exponent": "E+00",
    "bold": true
  },
  {
    "quantity": "length",
    "from": "ft",
    "to": "m",
    "nistFrom": "foot (ft)",
    "nistTo": "meter (m)",
    "printed": "3.048",
    "exponent": "E-01",
    "bold": true
  },
  {
    "quantity": "length",
    "from": "yd",
    "to": "m",
    "nistFrom": "yard (yd)",
    "nistTo": "meter (m)",
    "printed": "9.144",
    "exponent": "E-01",
    "bold": true
  },
  {
    "quantity": "length",
    "from": "mi",
    "to": "m",
    "nistFrom": "mile (mi)",
    "nistTo": "meter (m)",
    "printed": "1.609 344",
    "exponent": "E+03",
    "bold": true
  },
  {
    "quantity": "length",
    "from": "mi",
    "to": "km",
    "nistFrom": "mile (mi)",
    "nistTo": "kilometer (km)",
    "printed": "1.609 344",
    "exponent": "E+00",
    "bold": true
  },
  {
    "quantity": "length",
    "from": "nmi",
    "to": "m",
    "nistFrom": "mile, nautical ^20",
    "nistTo": "meter (m)",
    "printed": "1.852",
    "exponent": "E+03",
    "bold": true
  },
  {
    "quantity": "length",
    "from": "micron",
    "to": "m",
    "nistFrom": "micron (μ)",
    "nistTo": "meter (m)",
    "printed": "1.0",
    "exponent": "E-06",
    "bold": true
  },
  {
    "quantity": "length",
    "from": "micron",
    "to": "µm",
    "nistFrom": "micron (μ)",
    "nistTo": "micrometer (μm)",
    "printed": "1.0",
    "exponent": "E+00",
    "bold": true
  },
  {
    "quantity": "mass",
    "from": "gr",
    "to": "kg",
    "nistFrom": "grain (gr)",
    "nistTo": "kilogram (kg)",
    "printed": "6.479 891",
    "exponent": "E-05",
    "bold": true
  },
  {
    "quantity": "mass",
    "from": "gr",
    "to": "mg",
    "nistFrom": "grain (gr)",
    "nistTo": "milligram (mg)",
    "printed": "6.479 891",
    "exponent": "E+01",
    "bold": true
  },
  {
    "quantity": "mass",
    "from": "oz",
    "to": "kg",
    "nistFrom": "ounce (avoirdupois) (oz)",
    "nistTo": "kilogram (kg)",
    "printed": "2.834 952",
    "exponent": "E-02",
    "bold": false
  },
  {
    "quantity": "mass",
    "from": "oz",
    "to": "g",
    "nistFrom": "ounce (avoirdupois) (oz)",
    "nistTo": "gram (g)",
    "printed": "2.834 952",
    "exponent": "E+01",
    "bold": false
  },
  {
    "quantity": "mass",
    "from": "lb",
    "to": "kg",
    "nistFrom": "pound (avoirdupois) (lb) ^22",
    "nistTo": "kilogram (kg)",
    "printed": "4.535 924",
    "exponent": "E-01",
    "bold": false
  },
  {
    "quantity": "mass",
    "from": "long tn",
    "to": "kg",
    "nistFrom": "ton, long (2240 lb)",
    "nistTo": "kilogram (kg)",
    "printed": "1.016 047",
    "exponent": "E+03",
    "bold": false
  },
  {
    "quantity": "mass",
    "from": "sh tn",
    "to": "kg",
    "nistFrom": "ton, short (2000 lb)",
    "nistTo": "kilogram (kg)",
    "printed": "9.071 847",
    "exponent": "E+02",
    "bold": false
  },
  {
    "quantity": "mass",
    "from": "t",
    "to": "kg",
    "nistFrom": "ton, metric (t)",
    "nistTo": "kilogram (kg)",
    "printed": "1.0",
    "exponent": "E+03",
    "bold": true
  },
  {
    "quantity": "volume",
    "from": "in3",
    "to": "m3",
    "nistFrom": "cubic inch (in^3) ^13",
    "nistTo": "cubic meter (m^3)",
    "printed": "1.638 706",
    "exponent": "E-05",
    "bold": false
  },
  {
    "quantity": "volume",
    "from": "ft3",
    "to": "m3",
    "nistFrom": "cubic foot (ft^3)",
    "nistTo": "cubic meter (m^3)",
    "printed": "2.831 685",
    "exponent": "E-02",
    "bold": false
  },
  {
    "quantity": "volume",
    "from": "gal",
    "to": "m3",
    "nistFrom": "gallon (U.S.) (gal)",
    "nistTo": "cubic meter (m^3)",
    "printed": "3.785 412",
    "exponent": "E-03",
    "bold": false
  },
  {
    "quantity": "volume",
    "from": "gal",
    "to": "L",
    "nistFrom": "gallon (U.S.) (gal)",
    "nistTo": "liter (L)",
    "printed": "3.785 412",
    "exponent": "E+00",
    "bold": false
  },
  {
    "quantity": "volume",
    "from": "imp gal",
    "to": "m3",
    "nistFrom": "gallon [Canadian and U.K. (Imperial)] (gal)",
    "nistTo": "cubic meter (m^3)",
    "printed": "4.546 09",
    "exponent": "E-03",
    "bold": true
  },
  {
    "quantity": "volume",
    "from": "imp gal",
    "to": "L",
    "nistFrom": "gallon [Canadian and U.K. (Imperial)] (gal)",
    "nistTo": "liter (L)",
    "printed": "4.546 09",
    "exponent": "E+00",
    "bold": true
  },
  {
    "quantity": "volume",
    "from": "qt",
    "to": "L",
    "nistFrom": "quart (U.S. liquid) (liq qt)",
    "nistTo": "liter (L)",
    "printed": "9.463 529",
    "exponent": "E-01",
    "bold": false
  },
  {
    "quantity": "volume",
    "from": "pt",
    "to": "L",
    "nistFrom": "pint (U.S. liquid) (liq pt)",
    "nistTo": "liter (L)",
    "printed": "4.731 765",
    "exponent": "E-01",
    "bold": false
  },
  {
    "quantity": "volume",
    "from": "cup",
    "to": "L",
    "nistFrom": "cup (U.S.)",
    "nistTo": "liter (L)",
    "printed": "2.365 882",
    "exponent": "E-01",
    "bold": false
  },
  {
    "quantity": "volume",
    "from": "cup",
    "to": "mL",
    "nistFrom": "cup (U.S.)",
    "nistTo": "milliliter (mL)",
    "printed": "2.365 882",
    "exponent": "E+02",
    "bold": false
  },
  {
    "quantity": "volume",
    "from": "fl oz",
    "to": "mL",
    "nistFrom": "ounce (U.S. fluid) (fl oz)",
    "nistTo": "milliliter (mL)",
    "printed": "2.957 353",
    "exponent": "E+01",
    "bold": false
  },
  {
    "quantity": "volume",
    "from": "L",
    "to": "m3",
    "nistFrom": "liter (L) ^19",
    "nistTo": "cubic meter (m^3)",
    "printed": "1.0",
    "exponent": "E-03",
    "bold": true
  },
  {
    "quantity": "area",
    "from": "ha",
    "to": "m2",
    "nistFrom": "hectare (ha)",
    "nistTo": "square meter (m^2)",
    "printed": "1.0",
    "exponent": "E+04",
    "bold": true
  },
  {
    "quantity": "area",
    "from": "in2",
    "to": "m2",
    "nistFrom": "square inch (in^2)",
    "nistTo": "square meter (m^2)",
    "printed": "6.4516",
    "exponent": "E-04",
    "bold": true
  },
  {
    "quantity": "area",
    "from": "in2",
    "to": "cm2",
    "nistFrom": "square inch (in^2)",
    "nistTo": "square centimeter (cm^2)",
    "printed": "6.4516",
    "exponent": "E+00",
    "bold": true
  },
  {
    "quantity": "area",
    "from": "ft2",
    "to": "m2",
    "nistFrom": "square foot (ft^2)",
    "nistTo": "square meter (m^2)",
    "printed": "9.290 304",
    "exponent": "E-02",
    "bold": true
  },
  {
    "quantity": "area",
    "from": "yd2",
    "to": "m2",
    "nistFrom": "square yard (yd^2)",
    "nistTo": "square meter (m^2)",
    "printed": "8.361 274",
    "exponent": "E-01",
    "bold": false
  },
  {
    "quantity": "area",
    "from": "mi2",
    "to": "m2",
    "nistFrom": "square mile (mi^2)",
    "nistTo": "square meter (m^2)",
    "printed": "2.589 988",
    "exponent": "E+06",
    "bold": false
  },
  {
    "quantity": "area",
    "from": "mi2",
    "to": "km2",
    "nistFrom": "square mile (mi^2)",
    "nistTo": "square kilometer (km^2)",
    "printed": "2.589 988",
    "exponent": "E+00",
    "bold": false
  },
  {
    "quantity": "speed",
    "from": "mi/h",
    "to": "m/s",
    "nistFrom": "mile per hour (mi/h)",
    "nistTo": "meter per second (m/s)",
    "printed": "4.4704",
    "exponent": "E-01",
    "bold": true
  },
  {
    "quantity": "speed",
    "from": "mi/h",
    "to": "km/h",
    "nistFrom": "mile per hour (mi/h)",
    "nistTo": "kilometer per hour (km/h)",
    "printed": "1.609 344",
    "exponent": "E+00",
    "bold": true
  },
  {
    "quantity": "speed",
    "from": "ft/s",
    "to": "m/s",
    "nistFrom": "foot per second (ft/s)",
    "nistTo": "meter per second (m/s)",
    "printed": "3.048",
    "exponent": "E-01",
    "bold": true
  },
  {
    "quantity": "speed",
    "from": "km/h",
    "to": "m/s",
    "nistFrom": "kilometer per hour (km/h)",
    "nistTo": "meter per second (m/s)",
    "printed": "2.777 778",
    "exponent": "E-01",
    "bold": false
  },
  {
    "quantity": "speed",
    "from": "kn",
    "to": "m/s",
    "nistFrom": "knot (nautical mile per hour)",
    "nistTo": "meter per second (m/s)",
    "printed": "5.144 444",
    "exponent": "E-01",
    "bold": false
  },
  {
    "quantity": "pressure",
    "from": "atm",
    "to": "Pa",
    "nistFrom": "atmosphere, standard (atm)",
    "nistTo": "pascal (Pa)",
    "printed": "1.013 25",
    "exponent": "E+05",
    "bold": true
  },
  {
    "quantity": "pressure",
    "from": "atm",
    "to": "kPa",
    "nistFrom": "atmosphere, standard (atm)",
    "nistTo": "kilopascal (kPa)",
    "printed": "1.013 25",
    "exponent": "E+02",
    "bold": true
  },
  {
    "quantity": "pressure",
    "from": "bar",
    "to": "Pa",
    "nistFrom": "bar (bar)",
    "nistTo": "pascal (Pa)",
    "printed": "1.0",
    "exponent": "E+05",
    "bold": true
  },
  {
    "quantity": "pressure",
    "from": "bar",
    "to": "kPa",
    "nistFrom": "bar (bar)",
    "nistTo": "kilopascal (kPa)",
    "printed": "1.0",
    "exponent": "E+02",
    "bold": true
  },
  {
    "quantity": "pressure",
    "from": "psi",
    "to": "Pa",
    "nistFrom": "pound-force per square inch (psi) (lbf/in^2)",
    "nistTo": "pascal (Pa)",
    "printed": "6.894 757",
    "exponent": "E+03",
    "bold": false
  },
  {
    "quantity": "pressure",
    "from": "psi",
    "to": "kPa",
    "nistFrom": "pound-force per square inch (psi) (lbf/in^2)",
    "nistTo": "kilopascal (kPa)",
    "printed": "6.894 757",
    "exponent": "E+00",
    "bold": false
  },
  {
    "quantity": "pressure",
    "from": "mmHg",
    "to": "Pa",
    "nistFrom": "millimeter of mercury, conventional (mmHg) ^12",
    "nistTo": "pascal (Pa)",
    "printed": "1.333 224",
    "exponent": "E+02",
    "bold": false
  },
  {
    "quantity": "pressure",
    "from": "inHg",
    "to": "Pa",
    "nistFrom": "inch of mercury, conventional (inHg) ^12",
    "nistTo": "pascal (Pa)",
    "printed": "3.386 389",
    "exponent": "E+03",
    "bold": false
  },
  {
    "quantity": "pressure",
    "from": "Torr",
    "to": "Pa",
    "nistFrom": "torr (Torr)",
    "nistTo": "pascal (Pa)",
    "printed": "1.333 224",
    "exponent": "E+02",
    "bold": false
  },
  {
    "quantity": "energy",
    "from": "kWh",
    "to": "J",
    "nistFrom": "kilowatt hour (kW · h)",
    "nistTo": "joule (J)",
    "printed": "3.6",
    "exponent": "E+06",
    "bold": true
  },
  {
    "quantity": "energy",
    "from": "kWh",
    "to": "MJ",
    "nistFrom": "kilowatt hour (kW · h)",
    "nistTo": "megajoule (MJ)",
    "printed": "3.6",
    "exponent": "E+00",
    "bold": true
  },
  {
    "quantity": "energy",
    "from": "Wh",
    "to": "J",
    "nistFrom": "watt hour (W · h)",
    "nistTo": "joule (J)",
    "printed": "3.6",
    "exponent": "E+03",
    "bold": true
  },
  {
    "quantity": "energy",
    "from": "cal",
    "to": "J",
    "nistFrom": "calorie_th (cal_th) ^10",
    "nistTo": "joule (J)",
    "printed": "4.184",
    "exponent": "E+00",
    "bold": true
  },
  {
    "quantity": "energy",
    "from": "cal_IT",
    "to": "J",
    "nistFrom": "calorie_IT (cal_IT) ^10",
    "nistTo": "joule (J)",
    "printed": "4.1868",
    "exponent": "E+00",
    "bold": true
  },
  {
    "quantity": "energy",
    "from": "kcal",
    "to": "J",
    "nistFrom": "kilocalorie_th (kcal_th)",
    "nistTo": "joule (J)",
    "printed": "4.184",
    "exponent": "E+03",
    "bold": true
  },
  {
    "quantity": "energy",
    "from": "Btu_IT",
    "to": "J",
    "nistFrom": "British thermal unit_IT(Btu_IT)^9",
    "nistTo": "joule (J)",
    "printed": "1.055 056",
    "exponent": "E+03",
    "bold": false
  },
  {
    "quantity": "power",
    "from": "hp",
    "to": "W",
    "nistFrom": "horsepower (550 ft · lbf/s) (hp)",
    "nistTo": "watt (W)",
    "printed": "7.456 999",
    "exponent": "E+02",
    "bold": false
  },
  {
    "quantity": "power",
    "from": "PS",
    "to": "W",
    "nistFrom": "horsepower (metric)",
    "nistTo": "watt (W)",
    "printed": "7.354 988",
    "exponent": "E+02",
    "bold": false
  },
  {
    "quantity": "power",
    "from": "hp (electric)",
    "to": "W",
    "nistFrom": "horsepower (electric)",
    "nistTo": "watt (W)",
    "printed": "7.46",
    "exponent": "E+02",
    "bold": true
  },
  {
    "quantity": "angle",
    "from": "°",
    "to": "rad",
    "nistFrom": "degree (angle) (°)",
    "nistTo": "radian (rad)",
    "printed": "1.745 329",
    "exponent": "E-02",
    "bold": false
  },
  {
    "quantity": "angle",
    "from": "′",
    "to": "rad",
    "nistFrom": "minute (angle) (′)",
    "nistTo": "radian (rad)",
    "printed": "2.908 882",
    "exponent": "E-04",
    "bold": false
  },
  {
    "quantity": "angle",
    "from": "″",
    "to": "rad",
    "nistFrom": "second (angle) (″)",
    "nistTo": "radian (rad)",
    "printed": "4.848 137",
    "exponent": "E-06",
    "bold": false
  },
  {
    "quantity": "angle",
    "from": "gon",
    "to": "rad",
    "nistFrom": "gon (also called grade) (gon)",
    "nistTo": "radian (rad)",
    "printed": "1.570 796",
    "exponent": "E-02",
    "bold": false
  },
  {
    "quantity": "angle",
    "from": "gon",
    "to": "°",
    "nistFrom": "gon (also called grade) (gon)",
    "nistTo": "degree (angle) (°)",
    "printed": "9.0",
    "exponent": "E-01",
    "bold": true
  },
  {
    "quantity": "angle",
    "from": "rev",
    "to": "rad",
    "nistFrom": "revolution (r)",
    "nistTo": "radian (rad)",
    "printed": "6.283 185",
    "exponent": "E+00",
    "bold": false
  },
  {
    "quantity": "fuel-economy",
    "from": "mpg",
    "to": "km/L",
    "nistFrom": "mile per gallon (U.S.) (mpg) (mi/gal)",
    "nistTo": "kilometer per liter (km/L)",
    "printed": "4.251 437",
    "exponent": "E-01",
    "bold": false
  },
  {
    "quantity": "charge",
    "from": "Ah",
    "to": "C",
    "nistFrom": "ampere hour (A · h)",
    "nistTo": "coulomb (C)",
    "printed": "3.6",
    "exponent": "E+03",
    "bold": true
  },
  {
    "quantity": "time",
    "from": "min",
    "to": "s",
    "nistFrom": "minute (min)",
    "nistTo": "second (s)",
    "printed": "6.0",
    "exponent": "E+01",
    "bold": true
  },
  {
    "quantity": "time",
    "from": "h",
    "to": "s",
    "nistFrom": "hour (h)",
    "nistTo": "second (s)",
    "printed": "3.6",
    "exponent": "E+03",
    "bold": true
  },
  {
    "quantity": "time",
    "from": "d",
    "to": "s",
    "nistFrom": "day (d)",
    "nistTo": "second (s)",
    "printed": "8.64",
    "exponent": "E+04",
    "bold": true
  },
  {
    "quantity": "time",
    "from": "yr",
    "to": "s",
    "nistFrom": "year (365 days)",
    "nistTo": "second (s)",
    "printed": "3.1536",
    "exponent": "E+07",
    "bold": true
  }
];

/** The temperature formulas of NIST SP 811 Appendix B.9, as the page prints them. */
export const TEMPERATURE_FORMULAS: string[] = [
  "T /K = t /°C + 273.15",
  "t /°C = ( t /°F - 32 )/ 1.8",
  "T /K = ( t /°F + 459.67 )/ 1.8",
  "T /K = ( T /°R)/ 1.8",
  "t /°C = T /K - 273.15"
];

/** Where NIST itself states an exact factor for a unit whose B.8 row is not in boldface. */
export const EXACT_NOTES: ExactNote[] = [
  {
    "unit": "mass:lb",
    "source": "NIST SP 811 footnotes (22)",
    "quote": "The exact conversion factor is 4.535 923 7 E-01."
  },
  {
    "unit": "mass:oz",
    "source": "NIST Handbook 44 (2026) Appendix C",
    "quote": "0.028 349 523 125"
  },
  {
    "unit": "mass:short-ton",
    "source": "NIST Handbook 44 (2026) Appendix C",
    "quote": "907.184 74"
  },
  {
    "unit": "mass:long-ton",
    "source": "NIST Handbook 44 (2026) Appendix C",
    "quote": "1 016.046 908 8"
  },
  {
    "unit": "volume:in3",
    "source": "NIST SP 811 footnotes (13)",
    "quote": "The exact conversion factor is 1.638 706 4 E-05."
  },
  {
    "unit": "volume:ft3",
    "source": "NIST Handbook 44 (2026) Appendix C",
    "quote": "1 728 cubic inches"
  },
  {
    "unit": "volume:gal",
    "source": "NIST Handbook 44 (2026) Appendix C",
    "quote": "231 cubic inches (exactly)"
  },
  {
    "unit": "volume:qt",
    "source": "NIST Handbook 44 (2026) Appendix C",
    "quote": "2 pints = 1 quart (qt) = 57.75 cubic inches"
  },
  {
    "unit": "volume:pt",
    "source": "NIST Handbook 44 (2026) Appendix C",
    "quote": "4 gills (gi) = 1 pint (pt) = 28.875 cubic inches"
  },
  {
    "unit": "volume:cup",
    "source": "NIST Handbook 44 (2026) Appendix C",
    "quote": "8 fluid ounces (exactly)"
  },
  {
    "unit": "volume:fl-oz",
    "source": "NIST Handbook 44 (2026) Appendix C",
    "quote": "128 U.S. fluid ounces (exactly)"
  },
  {
    "unit": "area:yd2",
    "source": "NIST Handbook 44 (2026) Appendix C",
    "quote": "0.836 127 36 square meter"
  },
  {
    "unit": "area:mi2",
    "source": "NIST Handbook 44 (2026) Appendix C",
    "quote": "640 acres"
  },
  {
    "unit": "energy:btu-it",
    "source": "NIST SP 811 footnotes (9)",
    "quote": "the exact conversion factor for the International Table Btu is 1.055 055 852 62 kJ"
  },
  {
    "unit": "power:hp",
    "source": "NIST SP 811 footnotes (23)",
    "quote": "the exact conversion factor is 4.448 221 615 260 5 E+00"
  }
];
