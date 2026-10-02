# Upstream of rows.ts

`rows.ts` holds the rows of NIST SP 811 Appendix B.8 that the unit converter is cross-checked against, the temperature
formulas of Appendix B.9, and the places where NIST itself states an exact factor for a unit whose B.8 row is not in
boldface.

- **Documents** (all NIST publications, fetched 2026-10-02):
  - NIST Guide to the SI (Special Publication 811), Appendix B.8, "Factors for Units Listed Alphabetically":
    https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b8
    (21 tables, 445 rows, 147 of them in boldface).
  - Appendix B.9, "Factors for units listed by kind of quantity or field of science": the Temperature table.
  - Appendix B (the introduction, B.2 "A factor in boldface is exact. All other factors have been rounded to the
    significant digits given", B.3, B.7 "Rules for rounding numbers"):
    https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors
  - NIST Guide to the SI, Footnotes (the exact conversion factors of the pound, the cubic inch, the pound-force and the
    International Table Btu): https://www.nist.gov/pml/special-publication-811/nist-guide-si-footnotes
  - NIST Handbook 44 (2026), Appendix C, General Tables of Units of Measurement (the U.S. liquid volume units and the
    avoirdupois table, "(exactly)"): https://www.nist.gov/document/2026-nist-handbook-44-appendix-c
    (doi 10.6028/NIST.HB.44-2026).
  - The U.S. survey foot page (Beginning on January 1, 2023, the U.S. survey foot should be avoided ... superseded by the
    international foot definition): https://www.nist.gov/pml/us-surveyfoot
- **Copyright and licence:** NIST publications are works of the U.S. government and are not subject to copyright in the
  United States (17 U.S.C. 105). The rows are factual data and are attributed here.
- **How it was made:** a script (kept in the session scratch directory, not in this repository) reads the rows out of the
  saved B.8 page cell by cell (`printed` and `exponent` are the two "Multiply by" cells, `bold` is whether both are in a
  `<strong>` element) and writes the file. Only the pairing of each row with the unit symbols the converter accepts was
  typed. The script also checks that each quote in `EXACT_NOTES` is text found in the saved footnotes or Handbook 44
  text, and that each temperature formula is text found on the saved B.9 page.
- **Rows:** 72, of which 39 are in boldface (exact) and 33 are printed rounded.
