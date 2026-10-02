# Unit Converter

Convert length, mass, temperature, volume, area, speed, pressure, energy, power, angle, fuel economy, charge, frequency and time.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts between units of fourteen quantities in your browser, using factors built from their exact definitions with decimal arithmetic (the pound is 0.45359237 kg, the U.S. gallon is 231 cubic inches), and says which factors are exact. Type a value and two unit names or symbols to get the result with the factor used, or leave the second unit blank to see the value in every unit of the quantity. Nothing is uploaded.

## Supported

- Fourteen quantities: length, mass, temperature, volume, area, speed, pressure, energy, power, angle, fuel economy, electric charge, frequency and time
- International units (the inch is 0.0254 m, the foot 0.3048 m, the yard 0.9144 m, the mile 1609.344 m, the nautical mile 1852 m), U.S. liquid units (gallon, quart, pint, cup, fluid ounce), the imperial gallon, avoirdupois pounds, ounces, grains and tons, and the SI units with their prefixes
- Temperature in kelvin, degrees Celsius, degrees Fahrenheit and degrees Rankine, as readings (not differences), with absolute zero as the lowest value
- Fuel economy as litres per 100 km, kilometres per litre, miles per U.S. gallon, miles per imperial gallon and miles per litre
- Unit symbols matched with their case (mm and Mm, mg and Mg are different units) and unit names matched in any case; micro is accepted as the micro sign, the Greek letter mu or the letter u
- A result with 1 to 30 significant digits, rounded half to even, and a table of the value in every unit of the quantity

## Limits

- Factors are exact where the definition is exact (the inch is 0.0254 m, the pound 0.45359237 kg) and marked rounded otherwise; results show the significant digits you choose, rounded half to even.
- International units only: the U.S. survey foot and the units derived from it are not offered.
- Temperature converts readings, not differences; a value below absolute zero is refused.
- Fuel economy is a reciprocal pair, so zero cannot be converted.
- No currency, and no units outside the fourteen quantities.
- A value may have up to 50 digits and must be between -1e100 and 1e100; it is read as typed, never as a binary floating point number.
- A factor is marked exact only when its definition is exact and it is a finite decimal, so a factor whose decimal does not end (the pound-force per square inch, a knot, a kilometre per hour, a degree) is shown rounded to the digits you choose and marked rounded, although its definition is exact.

## Ambiguous cases, and what this does about them

- A bare ton, gallon, pint, quart, cup or fluid ounce is not accepted: the short ton (2000 lb), the long ton (2240 lb) and the metric tonne, the U.S. and imperial gallons, and the U.S. fluid ounce are different, so each is named in full. In mass, pound and ounce mean the avoirdupois units; troy and apothecary units are not offered
- A calorie here is the thermochemical calorie (4.184 J); the International Table calorie (4.1868 J) is a separate unit, and so is the International Table Btu
- The year is 365 days (31 536 000 s); the tropical and sidereal years are not offered
- The torr and the conventional millimetre and inch of mercury are shown rounded, because the sources do not state them as exact, and the metric horsepower is shown rounded for the same reason
- A temperature in degrees Fahrenheit is turned into kelvin by the exact rule (value + 459.67) x 5/9; the fraction 5/9 does not end as a decimal, so the factor is marked rounded even though 32 degrees Fahrenheit is exactly 273.15 K
- Miles per gallon is a distance per volume and litres per 100 km a volume per distance; they are reciprocals, so a value of zero or less is refused
- A value is rounded once at the end, so a long chain of conversions typed by hand can differ in the last digit from one step

## Defined by

- [NIST SP 811 Appendix B.8](https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b8)
- [The International System of Units (SI Brochure)](https://www.bipm.org/en/publications/si-brochure)
- [NIST Handbook 44 (2026), Appendix C: General Tables of Units of Measurement](https://doi.org/10.6028/NIST.HB.44-2026)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/unit-converter unit-converter
cd unit-converter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/unit-converter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { convertUnit, listUnits } from '@fodt/unit-converter';

const miles = convertUnit('length', '1', 'mi', 'm', 10);
console.log(miles.result, miles.exact);
// 1609.344 true
const kelvin = convertUnit('temperature', '32', 'F', 'K', 10);
console.log(kelvin.result);
// 273.15
console.log(listUnits('time', '1', 'h', 6).map((row) => `${row.symbol} ${row.value}`));
```

`convertUnit(quantity, value, from, to, digits)` takes the value as text, the two units as a symbol or a name and the significant digits (a whole number from 1 to 30), and returns `{ result, factor, exact, definition }`. `listUnits(quantity, value, from, digits)` returns the value in every unit of the quantity. `findUnit(quantity, text)` finds a unit by symbol (with its case) or name (in any case). `QUANTITIES` lists the fourteen quantities and `UNITS` their units, each with its `symbol`, `names`, `factor` (decimal text at 50 digits, built from `num` / `den`), `exact` and `definition`. Every expected failure is a `UnitConverterError` with a plain message and the `field` it is about (`Value`, `From unit`, `To unit` or `Significant digits`).

## Dependencies

- `decimal.js` 10.6.0

## Tests

```sh
npm test
```

Factors are checked against NIST SP 811 Appendix B.8 (the page is fetched and its rows are copied into test/fixtures with the printed digits and whether NIST prints them in boldface, which NIST says means exact), against the footnotes of that guide and Handbook 44 where they give the exact value, and against exact fractions worked out by Python 3.14.3 (fractions and decimal) for the definitions whose decimals end and for the ones that do not, quoted as literals in the test comments. Temperature uses the formulas of NIST SP 811 B.9. Rounding follows the rules of NIST SP 811 B.7.1 and its worked examples. Nothing is checked against this folder's own output.

## Licence

MIT. See [LICENSE](./LICENSE).
