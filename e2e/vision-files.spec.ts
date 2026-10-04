import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildFixtureFile, writePng } from './fixture-files';

/**
 * The real-file proofs of phase 15 (D-168, D-169, D-199, D-201): pages that read or rewrite a picked file are driven with
 * real files in four browsers, and what comes out is checked against what the file writers were given, never against the
 * page's own earlier output. Plan 15-04 creates this spec (the PDF Text Extractor & Metadata Remover); later plans of the
 * phase append their own tests to it. Helpers are written here, a close copy in shape of e2e/vision-workers.spec.ts, and
 * never imported from another spec, so an edit to any other spec does not rerun this one. The only import is the builders
 * of ./fixture-files, which this spec may read and never edit.
 *
 * The PDF fixtures below are base64 text of files written by reportlab 5.0.1, pikepdf 10.16.0 and pypdf 6.19.0, made by
 * tools/pdf-text-metadata/test/fixtures/make-fixtures.py (run `python tools/pdf-text-metadata/test/fixtures/make-fixtures.py`
 * in an environment that has those three packages; the strings given to the writers are listed at the top of the
 * `pdfs.ts` it writes). TAGGED_PDF is F1_FULL, INCREMENTAL_PDF is F2_INCREMENTAL, OWNER_PDF is F3_OWNER_ENCRYPTED and
 * USER_PASSWORD_PDF is F4_USER_ENCRYPTED (the password is user-pw, which no test ever gives).
 */
const rel = (path: string) => path.replace(/^\//, '');

interface PickedFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

const TAGGED_PDF =
  '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IDAgb2JqCjw8IC9TdWJ0eXBlIC9YTUwgL1R5cGUgL01ldGFkYXRhIC9MZW5ndGggNjM3ID4+CnN0cmVhbQo8P3hwYWNrZXQgYmVnaW49Iu+7vyIgaWQ9Ilc1TTBNcENlaGlIenJlU3pOVGN6a2M5ZCI/Pgo8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJwaWtlcGRmIj4KIDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+CiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIj48ZGM6dGl0bGUgeG1sbnM6ZGM9Imh0dHA6Ly9wdXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvIj48cmRmOkFsdD48cmRmOmxpIHhtbDpsYW5nPSJ4LWRlZmF1bHQiPlNFTlRJTkVMLVhNUC1USVRMRS01NWFhPC9yZGY6bGk+PC9yZGY6QWx0PjwvZGM6dGl0bGU+PGRjOmNyZWF0b3IgeG1sbnM6ZGM9Imh0dHA6Ly9wdXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvIj48cmRmOlNlcT48cmRmOmxpPlNFTlRJTkVMLVhNUC1DUkVBVE9SLUJvYjwvcmRmOmxpPjwvcmRmOlNlcT48L2RjOmNyZWF0b3I+PHhtcDpDcmVhdG9yVG9vbCB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iPlNFTlRJTkVMLVhNUC1UT09MPC94bXA6Q3JlYXRvclRvb2w+PC9yZGY6RGVzY3JpcHRpb24+PC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4KCjw/eHBhY2tldCBlbmQ9InciPz4KCmVuZHN0cmVhbQplbmRvYmoKMTYgMCBvYmoKPDwgL1R5cGUgL1hSZWYgL0xlbmd0aCA0NCAvRmlsdGVyIC9GbGF0ZURlY29kZSAvRGVjb2RlUGFybXMgPDwgL0NvbHVtbnMgNCAvUHJlZGljdG9yIDEyID4+IC9XIFsgMSAyIDEgXSAvSW5mbyA5IDAgUiAvUm9vdCA4IDAgUiAvU2l6ZSAxNyAvSUQgWzw5YTRhYWIzNzVjNDE0N2ZkYWFjMTJiNGI3MDcxZmFmYz48MjE3ZDJkMWM4NTA0NTRmNGI0Mjc1MDU5MDkyOGE5MTU+XSA+PgpzdHJlYW0KeJxjYgACJkYGfhDxiYEJyGMkhvjPdPwHEwPjT6AOpmAGKAvCPc8AAMufCAIKZW5kc3RyZWFtCmVuZG9iagpzdGFydHhyZWYKMjUxNwolJUVPRgo=';
const INCREMENTAL_PDF =
  'JVBERi0xLjMKJb/3ov4KMSAwIG9iago8PCAvTWV0YWRhdGEgMyAwIFIgL1BhZ2VNb2RlIC9Vc2VOb25lIC9QYWdlcyA0IDAgUiAvVHlwZSAvQ2F0YWxvZyA+PgplbmRvYmoKMiAwIG9iago8PCAvQXV0aG9yIChTRU5USU5FTC1BVVRIT1ItQWRhIExvdmVsYWNlKSAvQ3JlYXRpb25EYXRlIChEOjIwMjAwMTAyMDMwNDA1KzAyJzAwJykgL0NyZWF0b3IgKFNFTlRJTkVMLUNSRUFUT1ItV3JpdGVyIDkpIC9DdXN0b21LZXkgKFNFTlRJTkVMLUNVU1RPTS1WQUxVRSkgL0tleXdvcmRzIChTRU5USU5FTC1LRVlXT1JEUy14eXopIC9Nb2REYXRlIChEOjIwMjEwMjAzMDQwNTA2WikgL1Byb2R1Y2VyIChTRU5USU5FTC1QUk9EVUNFUi1NYWtlciAzKSAvU3ViamVjdCAoU0VOVElORUwtU1VCSkVDVC05MWJjKSAvVGl0bGUgKFNFTlRJTkVMLVRJVExFLTdmM2EpIC9UcmFwcGVkIC9GYWxzZSA+PgplbmRvYmoKMyAwIG9iago8PCAvU3VidHlwZSAvWE1MIC9UeXBlIC9NZXRhZGF0YSAvTGVuZ3RoIDYzNyA+PgpzdHJlYW0KPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4KPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0icGlrZXBkZiI+CiA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPgogPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiI+PGRjOnRpdGxlIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyI+PHJkZjpBbHQ+PHJkZjpsaSB4bWw6bGFuZz0ieC1kZWZhdWx0Ij5TRU5USU5FTC1YTVAtVElUTEUtNTVhYTwvcmRmOmxpPjwvcmRmOkFsdD48L2RjOnRpdGxlPjxkYzpjcmVhdG9yIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyI+PHJkZjpTZXE+PHJkZjpsaT5TRU5USU5FTC1YTVAtQ1JFQVRPUi1Cb2I8L3JkZjpsaT48L3JkZjpTZXE+PC9kYzpjcmVhdG9yPjx4bXA6Q3JlYXRvclRvb2wgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIj5TRU5USU5FTC1YTVAtVE9PTDwveG1wOkNyZWF0b3JUb29sPjwvcmRmOkRlc2NyaXB0aW9uPjwvcmRmOlJERj4KPC94OnhtcG1ldGE+Cgo8P3hwYWNrZXQgZW5kPSJ3Ij8+CgplbmRzdHJlYW0KZW5kb2JqCjQgMCBvYmoKPDwgL0NvdW50IDMgL0tpZHMgWyA1IDAgUiA2IDAgUiA3IDAgUiBdIC9UeXBlIC9QYWdlcyA+PgplbmRvYmoKNSAwIG9iago8PCAvQ29udGVudHMgOCAwIFIgL0xhc3RNb2RpZmllZCAoRDoyMDIwMDEwMjAzMDQwNVopIC9NZWRpYUJveCBbIDAgMCA1OTUuMjc1NiA4NDEuODg5OCBdIC9NZXRhZGF0YSA5IDAgUiAvUGFyZW50IDQgMCBSIC9QaWVjZUluZm8gPDwgL015QXBwIDw8IC9MYXN0TW9kaWZpZWQgKEQ6MjAyMDAxMDIwMzA0MDVaKSAvUHJpdmF0ZSA8PCAvU2VjcmV0IChTRU5USU5FTC1QSUVDRUlORk8tWlopID4+ID4+ID4+IC9SZXNvdXJjZXMgPDwgL0ZvbnQgMTAgMCBSIC9Qcm9jU2V0IFsgL1BERiAvVGV4dCAvSW1hZ2VCIC9JbWFnZUMgL0ltYWdlSSBdID4+IC9Sb3RhdGUgMCAvVHJhbnMgPDwgPj4gL1R5cGUgL1BhZ2UgPj4KZW5kb2JqCjYgMCBvYmoKPDwgL0NvbnRlbnRzIDExIDAgUiAvTWVkaWFCb3ggWyAwIDAgNTk1LjI3NTYgODQxLjg4OTggXSAvUGFyZW50IDQgMCBSIC9SZXNvdXJjZXMgPDwgL0ZvbnQgMTAgMCBSIC9Qcm9jU2V0IFsgL1BERiAvVGV4dCAvSW1hZ2VCIC9JbWFnZUMgL0ltYWdlSSBdID4+IC9Sb3RhdGUgMCAvVHJhbnMgPDwgPj4gL1R5cGUgL1BhZ2UgPj4KZW5kb2JqCjcgMCBvYmoKPDwgL0NvbnRlbnRzIDEyIDAgUiAvTWVkaWFCb3ggWyAwIDAgNTk1LjI3NTYgODQxLjg4OTggXSAvUGFyZW50IDQgMCBSIC9SZXNvdXJjZXMgPDwgL0ZvbnQgMTAgMCBSIC9Qcm9jU2V0IFsgL1BERiAvVGV4dCAvSW1hZ2VCIC9JbWFnZUMgL0ltYWdlSSBdID4+IC9Sb3RhdGUgMCAvVHJhbnMgPDwgPj4gL1R5cGUgL1BhZ2UgPj4KZW5kb2JqCjggMCBvYmoKPDwgL0ZpbHRlciBbIC9BU0NJSTg1RGVjb2RlIC9GbGF0ZURlY29kZSBdIC9MZW5ndGggMjI0ID4+CnN0cmVhbQpHYXJXcmJtSyVmJ1NiU1s9N0lqb0BlLUkvWz5MVlgvVjwqaC05XlhJMUovUi1xO0t0ZTYmUmFdJilOJ2IiOi45XFY/WVtFYlJYZ2ArYGdJMkBgVGVmZFgxR2ZnUXVDQmgxcUFaS0xoQzBVaysibiJiVFhXYi1XYElPQjlOZkxDJDktUXEybzFSOm91PVdFXFIlUSp1WF9JbFNFO01kTFBccDBUY0pjXmBRRUY2VyQrRC4paHBfUkM7Q1RVNkwxLiU+ZElkTTRmXF0uSDczQmRzbTREKzZfJS1pLT4pQ11+PgplbmRzdHJlYW0KZW5kb2JqCjkgMCBvYmoKPDwgL1N1YnR5cGUgL1hNTCAvVHlwZSAvTWV0YWRhdGEgL0xlbmd0aCAzMjcgPj4Kc3RyZWFtCjw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+PHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyI+PHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj48cmRmOkRlc2NyaXB0aW9uIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyI+PGRjOmRlc2NyaXB0aW9uPlNFTlRJTkVMLVBBR0UtWE1QLVFRPC9kYzpkZXNjcmlwdGlvbj48L3JkZjpEZXNjcmlwdGlvbj48L3JkZjpSREY+PC94OnhtcG1ldGE+PD94cGFja2V0IGVuZD0idyI/PgplbmRzdHJlYW0KZW5kb2JqCjEwIDAgb2JqCjw8IC9GMSAxMyAwIFIgL0YyIDE0IDAgUiA+PgplbmRvYmoKMTEgMCBvYmoKPDwgL0ZpbHRlciBbIC9BU0NJSTg1RGVjb2RlIC9GbGF0ZURlY29kZSBdIC9MZW5ndGggMjI0ID4+CnN0cmVhbQpHYXJXcl1hZldKJ1NiUztYOCMuQFZLKiQkM1ovVSUqKSxdLjwmZCxQL09WO19uZFk3VkVUZTpTakYnb21LRiRYV0FxPnJZRkBSR1s8SWJeRTVqYmdWXy51akU0cjkuJ3JlTGxbNm9wQyUvQWQjbCklbVxNZ3BoQS1GYlVnTCkkcU01YCdYSDlpV2w1LmUlcC4pTkZPZl8vJ3JUR3IwbE8xbjknWllhQkBQRFQyKSEqJExWWSlJLUQxTThuYllkRnVlMmk7a3JOWT9oNyJIW1V0WFpwPCxzRiNRKSkoRFp+PgplbmRzdHJlYW0KZW5kb2JqCjEyIDAgb2JqCjw8IC9GaWx0ZXIgWyAvQVNDSUk4NURlY29kZSAvRmxhdGVEZWNvZGUgXSAvTGVuZ3RoIDIyNCA+PgpzdHJlYW0KR2FyV3JibUslZidTYlNbPTdJam9AZS1JL1s+TFZYL1Y8KmgtOV5YSTFKL1ItcTtLdGU2JlJhXSYpTidiIjouOVxWP1lbRWJSWGdgK2BnSTJAYFRlZmRYMUdmZ1F1Q0JoMXFBWktMaEMwVWsrIm4iWD9AVS5hdGhuNVtHVjMrIXEsUUBqMk5hQjswcz5WL0R1Mjw4Jyttcm9JZjUvVWtyYWdPSiVwNUJDI19iYl9YSVsiNW9bJGY+LFVKbXFvYlRram9rOGx0NWRtQylwaFZRIVtuWzJKZjBUKUM2NEVXfj4KZW5kc3RyZWFtCmVuZG9iagoxMyAwIG9iago8PCAvQmFzZUZvbnQgL0hlbHZldGljYSAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyAvTmFtZSAvRjEgL1N1YnR5cGUgL1R5cGUxIC9UeXBlIC9Gb250ID4+CmVuZG9iagoxNCAwIG9iago8PCAvQmFzZUZvbnQgL1RpbWVzLVJvbWFuIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nIC9OYW1lIC9GMiAvU3VidHlwZSAvVHlwZTEgL1R5cGUgL0ZvbnQgPj4KZW5kb2JqCnhyZWYKMCAxNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA5OSAwMDAwMCBuIAowMDAwMDAwNDUwIDAwMDAwIG4gCjAwMDAwMDExNjggMDAwMDAgbiAKMDAwMDAwMTIzOSAwMDAwMCBuIAowMDAwMDAxNjAwIDAwMDAwIG4gCjAwMDAwMDE4MDEgMDAwMDAgbiAKMDAwMDAwMjAwMiAwMDAwMCBuIAowMDAwMDAyMzE3IDAwMDAwIG4gCjAwMDAwMDI3MjUgMDAwMDAgbiAKMDAwMDAwMjc2OSAwMDAwMCBuIAowMDAwMDAzMDg1IDAwMDAwIG4gCjAwMDAwMDM0MDEgMDAwMDAgbiAKMDAwMDAwMzUwOSAwMDAwMCBuIAp0cmFpbGVyIDw8IC9JbmZvIDIgMCBSIC9Sb290IDEgMCBSIC9TaXplIDE1IC9JRCBbPDlhNGFhYjM3NWM0MTQ3ZmRhYWMxMmI0YjcwNzFmYWZjPjwxNzg4NWM5ZTM5YWI3Zjc3MGMxMGZkYTViNzNlNzhmZj5dID4+CnN0YXJ0eHJlZgozNjE5CiUlRU9GCjEgMCBvYmoKPDwKL01ldGFkYXRhIDE2IDAgUgovUGFnZU1vZGUgL1VzZU5vbmUKL1BhZ2VzIDQgMCBSCi9UeXBlIC9DYXRhbG9nCj4+CmVuZG9iagoxNSAwIG9iago8PAovQXV0aG9yIChTRU5USU5FTFwwNTVBVVRIT1JcMDU1UkVWMlwwNTVHcmFjZSkKL1RpdGxlIChTRU5USU5FTFwwNTVUSVRMRVwwNTVSRVYyKQo+PgplbmRvYmoKMTYgMCBvYmoKPDwKL1R5cGUgL01ldGFkYXRhCi9TdWJ0eXBlIC9YTUwKL0xlbmd0aCAzNjYKPj4Kc3RyZWFtCjw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+PHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyI+PHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj48cmRmOkRlc2NyaXB0aW9uIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyI+PGRjOmNyZWF0b3I+PHJkZjpTZXE+PHJkZjpsaT5TRU5USU5FTC1YTVAtQ1JFQVRPUi1SRVYyLUNhcm9sPC9yZGY6bGk+PC9yZGY6U2VxPjwvZGM6Y3JlYXRvcj48L3JkZjpEZXNjcmlwdGlvbj48L3JkZjpSREY+PC94OnhtcG1ldGE+PD94cGFja2V0IGVuZD0idyI/PgplbmRzdHJlYW0KZW5kb2JqCjE3IDAgb2JqPDwKL1R5cGUgL1hSZWYKL1NpemUgMTgKL1Jvb3QgMSAwIFIKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL0luZGV4IFsgMSAxIDE1IDIgXQovVyBbIDEgNCAxIF0KL0luZm8gMTUgMCBSCi9QcmV2IDM2MTkKL0lEIFsgPDlhNGFhYjM3NWM0MTQ3ZmRhYWMxMmI0YjcwNzFmYWZjPiA8MTc4ODVjOWUzOWFiN2Y3NzBjMTBmZGE1YjczZTc4ZmY+IF0KL0xlbmd0aCAyMwo+PgpzdHJlYW0KeJxjZGDgf8HAyMAgYAsmlzAAABG3AfwKZW5kc3RyZWFtCmVuZG9iagpzdGFydHhyZWYKNDcwOAolJUVPRgo=';
const OWNER_PDF =
  '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ZWFhMzI2OTZjMTVmNGRjOWIwMDYxY2MxYmNjMWI1MzIyYTFmZjY4YmRjZWFiZTQyOTY5Zjg0YWIzPiAvT0UgPDNiOWU5OTJjYzdjMjFlZjZjNzQxMzc2Mzc5NmZhM2EyYjg4Y2ZlZjYyZDc4MWI3ZjMyYzI0NjBmNjY0MGQ0M2U+IC9QIC0xMDI4IC9QZXJtcyA8ODExMDg0MzZkZjM3OTBlMTE1ODY1YjQ3NTViYjdkY2E+IC9SIDYgL1N0bUYgL1N0ZENGIC9TdHJGIC9TdGRDRiAvVSA8M2UxZjUyMDAxOTYzZThkYjRiNWUzZjc2M2ZlYTQ5ZWFiNGY3NWVjYjgxMGVmMmM2NjY2YmI0NDNiODA2ZTlkYzJmZmQ2OGVlOGUwNGQ5NWNjNzViZWNjNWZhMTRmODFmPiAvVUUgPGEzM2FkN2QzNjJmYzAzMzk2ZTYyZGVlNTdjYWYzMjIyYjJiNzhiYWM3ZjA3NDY4NmQ1YmYwODBmNWEyY2RlMTE+IC9WIDUgPj4KZW5kb2JqCjE3IDAgb2JqCjw8IC9UeXBlIC9YUmVmIC9MZW5ndGggNTAgL0ZpbHRlciAvRmxhdGVEZWNvZGUgL0RlY29kZVBhcm1zIDw8IC9Db2x1bW5zIDQgL1ByZWRpY3RvciAxMiA+PiAvVyBbIDEgMiAxIF0gL0luZm8gOSAwIFIgL1Jvb3QgMSAwIFIgL1NpemUgMTggL0lEIFs8OWE0YWFiMzc1YzQxNDdmZGFhYzEyYjRiNzA3MWZhZmM+PDJjY2EyOTJlNzdhMTQ1Y2JkMmQ0YjU5NGU3NjU5ZjczPl0gL0VuY3J5cHQgMTYgMCBSID4+CnN0cmVhbQp4nGNiAAImRgZ+BiYGhhkgVjSIxcBIgPjPHPWTiYHpOVAxoySISIezQASzOgMAxNMFTgplbmRzdHJlYW0KZW5kb2JqCnN0YXJ0eHJlZgozMTAwCiUlRU9GCg==';
const USER_PASSWORD_PDF =
  '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fc88QAqbWGrTVkBd96OGiLfaZdEOVGFQw8lThEkvezK/2GmjuCn0/GmAhPfVrwpbVy2wzlXV67tSYMfV7GXI5r6AS4nXT9ulFNamdIX45BrbE1WpBNoi1u6yXfHM6LThnA7y1KbH5AplbmRzdHJlYW0KZW5kb2JqCjE0IDAgb2JqCjw8IC9GaWx0ZXIgL0ZsYXRlRGVjb2RlIC9MZW5ndGggMjA4ID4+CnN0cmVhbQqVMiSi5yBAb2gfwmlxtaLPGLo0ujy9/g1rcF/EOvGgbgKIsN1iDGt5d+sNbAoXqHa5QIJTjcyBtONUCT1cobVLpCacPNQd3sOV6rNqY2riZW04AViaECNjQMVDBGrKllTKlup4jfbcEswe6WpB1Gft5CyPvMpUgPlHgxkGwXWrSn4LFd379A+0t/pE3gK6DtjX73TMnL4PM4XNQCogDDFnmwwJ0Ctxqpn3d+Ytuf6aeKIiupOKmdLEV1wHwkfT+MOC4vRcv4Q6eSm4qbjnBqxJCmVuZHN0cmVhbQplbmRvYmoKMTUgMCBvYmoKPDwgL0ZpbHRlciAvRmxhdGVEZWNvZGUgL0xlbmd0aCAyMDggPj4Kc3RyZWFtCo8fpqI5Xyfb7C+7IOz3H6ElIrGEls6p0R4LcQYxRLkXz0uI9VMIpsbTiYaUwJhMFl98Ch3XR2p+ICPcIl8k4Mxxfx50brSRLn/yQnvvqKZ+d99NA9L3zscRAUXRahuQDXkuOWwAS/C0QMoIUqbxGXFLjGQWJXQuDd90ZmBkoDBevUb2OCl1kIIpS2sjm4gunZKcPZGoF3Xd0eqXafeTZuSx2i3V854YsU2cDAbH11Hmx/bYpbdY+vh5CePT9m1sZpyXlo8a4mjadDTbtMreKF4KZW5kc3RyZWFtCmVuZG9iagoxNiAwIG9iago8PCAvQ0YgPDwgL1N0ZENGIDw8IC9BdXRoRXZlbnQgL0RvY09wZW4gL0NGTSAvQUVTVjIgL0xlbmd0aCAxNiA+PiA+PiAvRmlsdGVyIC9TdGFuZGFyZCAvTGVuZ3RoIDEyOCAvTyA8OTM1MTdhYzBhNzdjOGM3MjNjNDliZDJmMTAyNGUwOTg5ZDY5NDA5YTBlNjliMTQyYTRlZTIwM2JiZWVlN2FhNj4gL09FIDw+IC9QIC0xMDI4IC9SIDQgL1N0bUYgL1N0ZENGIC9TdHJGIC9TdGRDRiAvVSA8ZTUxZDJkZDEzNTMxMjFkNTlhNjEwMjUyMTllNzMzODkwMDIxNDQ2OTkwYjllNDExNDA3MWE0ZDkxMDQ5ODRjMT4gL1VFIDw+IC9WIDQgPj4KZW5kb2JqCjE3IDAgb2JqCjw8IC9UeXBlIC9YUmVmIC9MZW5ndGggNDkgL0ZpbHRlciAvRmxhdGVEZWNvZGUgL0RlY29kZVBhcm1zIDw8IC9Db2x1bW5zIDQgL1ByZWRpY3RvciAxMiA+PiAvVyBbIDEgMiAxIF0gL0luZm8gOSAwIFIgL1Jvb3QgMSAwIFIgL1NpemUgMTggL0lEIFs8OWE0YWFiMzc1YzQxNDdmZGFhYzEyYjRiNzA3MWZhZmM+PDJjY2EyOTJlNzdhMTQ1Y2JkMmQ0YjU5NGU3NjU5ZjczPl0gL0VuY3J5cHQgMTYgMCBSID4+CnN0cmVhbQp4nGNiAAImRgZ+BiYGhjAQay6IxcBIgPjPLPGTiYHpOVAxoySISIezwIQtAwC7bwUgCmVuZHN0cmVhbQplbmRvYmoKc3RhcnR4cmVmCjI4MDAKJSVFT0YK';

function pdfFile(name: string, base64: string): PickedFile {
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(base64, 'base64') };
}

function outputArea(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

function runButtonOf(page: Page) {
  return page.getByRole('button', { name: 'Run', exact: true });
}

async function openTool(page: Page, id: string): Promise<void> {
  await page.goto(rel(`/tools/${id}`));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
}

/** Starts recording every request the page makes from now on, and returns the live list. */
function recordRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  return requests;
}

function offending(requests: string[]): string[] {
  return requests.filter((url) => !url.startsWith('data:') && !url.startsWith('blob:'));
}

/**
 * Attaches a file to the file field. The pages are prerendered, so a file set in the first moments after load can be
 * dropped again when the page finishes starting; the attachment is repeated until the page shows the file's name.
 */
async function attachFile(page: Page, file: PickedFile): Promise<void> {
  await expect(async () => {
    await page.locator('#f-file').setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
    await expect(page.locator('.field-help', { hasText: file.name })).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

async function chooseMode(page: Page, mode: 'text' | 'metadata' | 'remove'): Promise<void> {
  await page.locator(`input[name="mode"][value="${mode}"]`).click();
}

/** Fills a text field and checks the value stayed (the fill is repeated until it holds). */
async function fillField(page: Page, name: string, value: string): Promise<void> {
  const field = page.locator(`#f-${name}`);
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

/** The text of the first code block of the output, the way a visitor would copy it. */
async function codeText(page: Page): Promise<string> {
  return outputArea(page).locator('pre.output').first().innerText({ timeout: 1_000 });
}

/**
 * Every Flate stream of a PDF, decompressed and joined, so a marker hidden in a compressed object is still found. A
 * stream that is not Flate (or not compressed) is searched as written, which the plain scan of the file already does.
 */
function inflatedStreams(pdf: Buffer): string {
  const parts: string[] = [];
  let from = 0;
  for (;;) {
    const start = pdf.indexOf('stream', from, 'latin1');
    if (start < 0) break;
    let body = start + 'stream'.length;
    if (pdf[body] === 0x0d) body++;
    if (pdf[body] === 0x0a) body++;
    const end = pdf.indexOf('endstream', body, 'latin1');
    if (end < 0) break;
    try {
      parts.push(inflateSync(pdf.subarray(body, end)).toString('latin1'));
    } catch {
      // Not a Flate stream: nothing to add.
    }
    from = end + 'endstream'.length;
  }
  return parts.join('\n');
}

/** Clicks Download on the copy and returns its bytes. */
async function downloadCopy(page: Page): Promise<{ name: string; bytes: Buffer }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    outputArea(page).getByRole('button', { name: 'Download' }).click(),
  ]);
  const path = await download.path();
  return { name: download.suggestedFilename(), bytes: readFileSync(path) };
}

test('pdf-text-metadata: text of a three-page file comes back page by page in page order', async ({ page }) => {
  await openTool(page, 'pdf-text-metadata');
  // Recorded only after the page and its own chunk have loaded, so this asserts nothing is requested while a PDF is read.
  const requests = recordRequests(page);

  // The three-page file written by this repository's fixture writer: each page drew its own heading and the marker string
  // the writer was given.
  const marker = 'FODT-VISION-FILES-3';
  const three = buildFixtureFile('pdf-3', marker);
  await attachFile(page, { name: three.name, mimeType: three.mimeType, buffer: Buffer.from(three.buffer) });
  await runButtonOf(page).click();
  await expect(outputArea(page)).toContainText('--- Page 3 ---', { timeout: 30_000 });
  expect((await codeText(page)).trim().split('\n')).toEqual([
    '--- Page 1 ---',
    'Page 1',
    marker,
    '',
    '--- Page 2 ---',
    'Page 2',
    marker,
    '',
    '--- Page 3 ---',
    'Page 3',
    marker,
  ]);
  await expect(outputArea(page).locator('.stats')).toContainText('Pages read 3');

  // A page list reads only those pages, in the order written: page 3 then page 1.
  await fillField(page, 'pages', '3,1');
  await runButtonOf(page).click();
  await expect(async () => {
    expect((await codeText(page)).trim().split('\n')).toEqual([
      '--- Page 3 ---',
      'Page 3',
      marker,
      '',
      '--- Page 1 ---',
      'Page 1',
      marker,
    ]);
  }).toPass({ timeout: 15_000 });

  // A page past the end of the file is refused with the field's name and the page count.
  await fillField(page, 'pages', '9');
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('.issue-list')).toContainText('Pages:', { timeout: 15_000 });
  await expect(outputArea(page).locator('.issue-list')).toContainText('which has 3 pages');
  expect(await outputArea(page).locator('pre.output').count()).toBe(0);
  await fillField(page, 'pages', '');

  // A file written by another writer (reportlab), with two lines on each page, reads in order too: the lines of page 2 sit
  // between the headings of page 1 and page 3.
  await attachFile(page, pdfFile('tagged.pdf', TAGGED_PDF));
  await runButtonOf(page).click();
  await expect(async () => {
    const text = await codeText(page);
    const order = [
      '--- Page 1 ---',
      'Page 1 heading',
      'This is line one of page 1.',
      '--- Page 2 ---',
      'Page 2 heading',
      'This is line one of page 2.',
      'Second line, page 2: numbers 3.14159 and email test@example.com',
      '--- Page 3 ---',
      'Page 3 heading',
    ].map((needle) => text.indexOf(needle));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  }).toPass({ timeout: 15_000 });

  expect(offending(requests)).toEqual([]);
});

test('pdf-text-metadata: the request recorder of this spec sees a request the page makes', async ({ page }) => {
  // The detector the other tests rely on can fail: a script that asks for an address of the page's own origin is seen.
  await openTool(page, 'pdf-text-metadata');
  const requests = recordRequests(page);
  await page.evaluate(() => fetch('/tools/pdf-text-metadata/').then((response) => response.status));
  expect(offending(requests).length).toBeGreaterThanOrEqual(1);
});

test('pdf-text-metadata: the metadata of a tagged file is listed and its stripped copy re-reads with none', async ({
  page,
}) => {
  await openTool(page, 'pdf-text-metadata');
  const requests = recordRequests(page);

  await attachFile(page, pdfFile('sample.pdf', TAGGED_PDF));
  await chooseMode(page, 'metadata');
  await runButtonOf(page).click();
  const info = outputArea(page).locator('dl.kv');
  await expect(info).toContainText('SENTINEL-TITLE-7f3a', { timeout: 30_000 });
  for (const value of [
    'SENTINEL-AUTHOR-Ada Lovelace',
    'SENTINEL-SUBJECT-91bc',
    'SENTINEL-KEYWORDS-xyz',
    'SENTINEL-CREATOR-Writer 9',
    'SENTINEL-PRODUCER-Maker 3',
    "D:20200102030405+02'00' (2020-01-02T03:04:05+02:00)",
    'D:20210203040506Z (2021-02-03T04:05:06Z)',
    'SENTINEL-CUSTOM-VALUE',
  ]) {
    await expect(info).toContainText(value);
  }
  await expect(outputArea(page).locator('table.output-table')).toContainText('SENTINEL-XMP-TITLE-55aa');
  await expect(outputArea(page).locator('table.output-table')).toContainText('SENTINEL-XMP-CREATOR-Bob');

  // Remove: a copy named after the picked file, with a count of what was removed.
  await chooseMode(page, 'remove');
  await runButtonOf(page).click();
  await expect(outputArea(page)).toContainText('sample-clean.pdf', { timeout: 30_000 });
  await expect(outputArea(page)).toContainText('Two readers (PDF.js and pdf-lib) found no document information');
  const removed = outputArea(page).locator('dl.kv');
  await expect(removed).toContainText('Document information');
  await expect(removed).toContainText('removed');
  const copy = await downloadCopy(page);
  expect(copy.name).toBe('sample-clean.pdf');
  expect(copy.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  // No byte of the copy holds a marker string, written or after decompression, and no document information key is left.
  expect(copy.bytes.includes('SENTINEL')).toBe(false);
  expect(inflatedStreams(copy.bytes).includes('SENTINEL')).toBe(false);
  expect(copy.bytes.includes('/Info')).toBe(false);
  expect(copy.bytes.includes('/Metadata')).toBe(false);
  expect(copy.bytes.includes('/PieceInfo')).toBe(false);

  // The copy, picked again, is read by PDF.js (no document information, no XMP) ...
  await attachFile(page, { name: 'copy.pdf', mimeType: 'application/pdf', buffer: copy.bytes });
  await chooseMode(page, 'metadata');
  await runButtonOf(page).click();
  await expect(outputArea(page)).toContainText('This file has no document information.', { timeout: 30_000 });
  await expect(outputArea(page)).toContainText('This file has no XMP metadata.');
  // ... and by pdf-lib, which finds nothing to remove.
  await chooseMode(page, 'remove');
  await runButtonOf(page).click();
  await expect(outputArea(page)).toContainText('Nothing was found to remove in this file.', { timeout: 30_000 });
  await expect(outputArea(page).locator('dl.kv')).toContainText('none found');

  expect(offending(requests)).toEqual([]);
});

test('pdf-text-metadata: the author of an earlier saved revision is gone from the copy as well', async ({ page }) => {
  await openTool(page, 'pdf-text-metadata');
  const requests = recordRequests(page);
  // The file holds two revisions: the first writer's Info dictionary and XMP stream, and an incremental update that
  // points the trailer and the catalog at new ones (ISO 32000-1 7.5.6). The first revision's objects stay in the file.
  const input = pdfFile('revised.pdf', INCREMENTAL_PDF);
  expect(input.buffer.includes('Lovelace')).toBe(true);
  expect(input.buffer.includes('Grace')).toBe(true);
  await attachFile(page, input);
  await chooseMode(page, 'remove');
  await runButtonOf(page).click();
  await expect(outputArea(page)).toContainText('revised-clean.pdf', { timeout: 30_000 });
  const copy = await downloadCopy(page);
  for (const needle of ['Lovelace', 'Grace', 'Bob', 'Carol', 'SENTINEL']) {
    expect(copy.bytes.includes(needle), needle).toBe(false);
    expect(inflatedStreams(copy.bytes).includes(needle), needle).toBe(false);
  }
  expect(offending(requests)).toEqual([]);
});

test('pdf-text-metadata: a password-protected file is refused with a plain message and nothing is requested', async ({
  page,
}) => {
  await openTool(page, 'pdf-text-metadata');
  const requests = recordRequests(page);
  await attachFile(page, pdfFile('locked.pdf', USER_PASSWORD_PDF));
  for (const mode of ['text', 'metadata', 'remove'] as const) {
    await chooseMode(page, mode);
    await runButtonOf(page).click();
    await expect(outputArea(page).locator('.issue-list')).toContainText(
      'This PDF needs a password, which this page cannot use.',
      { timeout: 30_000 },
    );
    expect(await outputArea(page).locator('pre.output').count()).toBe(0);
    expect(await outputArea(page).getByRole('button', { name: 'Download' }).count()).toBe(0);
  }
  expect(offending(requests)).toEqual([]);
});

test('pdf-text-metadata: an encrypted file that needs no password is read but never rewritten', async ({ page }) => {
  await openTool(page, 'pdf-text-metadata');
  const requests = recordRequests(page);
  await attachFile(page, pdfFile('owner.pdf', OWNER_PDF));
  await runButtonOf(page).click();
  await expect(outputArea(page)).toContainText('Page 2 heading', { timeout: 30_000 });
  await chooseMode(page, 'remove');
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('.issue-list')).toContainText('This PDF is encrypted, so no copy is made', {
    timeout: 30_000,
  });
  expect(await outputArea(page).getByRole('button', { name: 'Download' }).count()).toBe(0);
  expect(offending(requests)).toEqual([]);
});

test('pdf-text-metadata: a file that is not a PDF is refused before it is read', async ({ page }) => {
  await openTool(page, 'pdf-text-metadata');
  const requests = recordRequests(page);
  await attachFile(page, {
    name: 'notes.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('FODT-MARKER plain text, not a document'),
  });
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('.issue-list')).toContainText('This is not a PDF file.', { timeout: 15_000 });
  await expect(outputArea(page).locator('.issue-list')).not.toContainText('FODT-MARKER');
  expect(offending(requests)).toEqual([]);
});

/** What the slowing wrapper of slowPdfWorker counts, kept on the page. */
declare global {
  interface Window {
    __FODT_PDF_DELAY_MS__?: number;
    __FODT_WORKERS_BUILT__?: number;
    __FODT_WORKERS_ENDED__?: number;
    __FODT_PROGRESS_SEEN__?: number[];
    __FODT_PDF_TEXT_METADATA_TEST_STALL_MS__?: number;
  }
}

/**
 * Before any page script runs: makes every message a worker sends to the page arrive `delayMs` later (in order, because
 * the delay is the same for every message), so a read of a long file takes long enough to watch and to cancel on every
 * engine; counts every worker the page builds and every one it ends; and, when `stallMs` is given, sets the page's
 * test-only stall limit. `window.__FODT_PDF_DELAY_MS__` can be set to 0 afterwards to let the next run go at full speed.
 */
async function slowPdfWorker(page: Page, delayMs: number, stallMs?: number): Promise<void> {
  await page.addInitScript(
    ([delay, stall]: [number, number | null]) => {
      window.__FODT_PDF_DELAY_MS__ = delay;
      window.__FODT_WORKERS_BUILT__ = 0;
      window.__FODT_WORKERS_ENDED__ = 0;
      if (stall !== null) window.__FODT_PDF_TEXT_METADATA_TEST_STALL_MS__ = stall;
      const originalAdd = Worker.prototype.addEventListener;
      Worker.prototype.addEventListener = function (
        this: Worker,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) {
        if (type === 'message' && typeof listener === 'function') {
          const wrapped = (event: Event) => {
            const wait = window.__FODT_PDF_DELAY_MS__ ?? 0;
            if (wait > 0) setTimeout(() => listener.call(this, event), wait);
            else listener.call(this, event);
          };
          return originalAdd.call(this, type, wrapped, options);
        }
        return originalAdd.call(this, type, listener, options);
      } as typeof Worker.prototype.addEventListener;
      const originalTerminate = Worker.prototype.terminate;
      Worker.prototype.terminate = function (this: Worker) {
        window.__FODT_WORKERS_ENDED__ = (window.__FODT_WORKERS_ENDED__ ?? 0) + 1;
        return originalTerminate.call(this);
      };
      window.Worker = new Proxy(window.Worker, {
        construct(target, args: ConstructorParameters<typeof Worker>) {
          window.__FODT_WORKERS_BUILT__ = (window.__FODT_WORKERS_BUILT__ ?? 0) + 1;
          return Reflect.construct(target, args) as Worker;
        },
      });
    },
    [delayMs, stallMs ?? null] as [number, number | null],
  );
}

/** How many workers the page has built and how many it has ended so far. */
async function workerCounts(page: Page): Promise<{ built: number; ended: number }> {
  return page.evaluate(() => ({
    built: window.__FODT_WORKERS_BUILT__ ?? 0,
    ended: window.__FODT_WORKERS_ENDED__ ?? 0,
  }));
}

function cancelButtonOf(page: Page) {
  return page.getByRole('button', { name: 'Cancel', exact: true });
}

test('pdf-text-metadata: text of a long file shows progress and Cancel stops it at once', async ({ page }) => {
  // Every message from PDF.js's worker is delayed, so the 150 page file takes seconds on every engine and can be watched.
  await slowPdfWorker(page, 40);
  await openTool(page, 'pdf-text-metadata');
  const requests = recordRequests(page);
  const long = buildFixtureFile('pdf-long', 'FODT-VISION-LONG');
  await attachFile(page, { name: long.name, mimeType: long.mimeType, buffer: Buffer.from(long.buffer) });

  // Record every value the progress bar takes from here on.
  await page.evaluate(() => {
    const seen: number[] = [];
    window.__FODT_PROGRESS_SEEN__ = seen;
    const record = () => {
      const bar = document.querySelector<HTMLProgressElement>('progress.tool-progress');
      if (bar && seen.at(-1) !== bar.value) seen.push(bar.value);
    };
    new MutationObserver(record).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['value'],
    });
  });
  await runButtonOf(page).click();
  await expect(cancelButtonOf(page)).toBeVisible();

  // Progress is reported page by page: the bar takes at least four different values, each larger than the one before, and
  // the run is still going (no text yet) when the fourth arrives.
  await expect
    .poll(() => page.evaluate(() => window.__FODT_PROGRESS_SEEN__?.length ?? 0), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(4);
  const seen = (await page.evaluate(() => window.__FODT_PROGRESS_SEEN__)) as number[];
  for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThan(seen[i - 1]!);
  expect(seen.at(-1)!).toBeLessThan(1);
  await expect(page.locator('progress.tool-progress')).toBeVisible();
  await expect(page.locator('.field-help', { hasText: /Page \d+ of 150/ })).toBeVisible();
  expect(await outputArea(page).locator('pre.output').count()).toBe(0);

  // Cancel: the run ends with the plain note and no text, and every worker the page built has been ended.
  await cancelButtonOf(page).click();
  const note = outputArea(page).locator('.note-warn');
  await expect(note).toHaveText('Cancelled before finishing. No result was produced.', { timeout: 3_000 });
  expect(await outputArea(page).locator('pre.output').count()).toBe(0);
  await expect(page.locator('progress.tool-progress')).toHaveCount(0);
  await expect.poll(() => workerCounts(page)).toEqual({ built: 1, ended: 1 });
  // Nothing arrives afterwards: a result that was already on its way is not shown.
  await page.waitForTimeout(800);
  expect(await outputArea(page).locator('pre.output').count()).toBe(0);
  await expect(note).toHaveText('Cancelled before finishing. No result was produced.');

  // The next run builds a new worker and finishes with every page.
  await page.evaluate(() => {
    window.__FODT_PDF_DELAY_MS__ = 0;
  });
  await runButtonOf(page).click();
  await expect(outputArea(page)).toContainText('--- Page 150 ---', { timeout: 30_000 });
  await expect(outputArea(page).locator('.stats')).toContainText('Pages read 150');
  await expect.poll(() => workerCounts(page)).toEqual({ built: 2, ended: 2 });
  expect(offending(requests)).toEqual([]);
});

test('pdf-text-metadata: an extraction that makes no progress stops with a plain message', async ({ page }) => {
  // The page's test-only stall limit is 50 ms and every message from the worker is delayed 300 ms, so the run makes no
  // progress for longer than the limit before its first page. The message a visitor would see is the fixed one.
  await slowPdfWorker(page, 300, 50);
  await openTool(page, 'pdf-text-metadata');
  const requests = recordRequests(page);
  const long = buildFixtureFile('pdf-long', 'FODT-VISION-STALL');
  await attachFile(page, { name: long.name, mimeType: long.mimeType, buffer: Buffer.from(long.buffer) });
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('.issue-list')).toContainText(
    'Stopped after 20 seconds without progress. The file may be unusually large or complex for this browser.',
    { timeout: 15_000 },
  );
  expect(await outputArea(page).locator('pre.output').count()).toBe(0);
  await expect.poll(() => workerCounts(page)).toEqual({ built: 1, ended: 1 });

  // The page stays usable: with the limit and the delay lifted, the same file reads in full on a new worker.
  await page.evaluate(() => {
    window.__FODT_PDF_DELAY_MS__ = 0;
    window.__FODT_PDF_TEXT_METADATA_TEST_STALL_MS__ = 0;
  });
  await runButtonOf(page).click();
  await expect(outputArea(page)).toContainText('--- Page 150 ---', { timeout: 30_000 });
  await expect.poll(() => workerCounts(page)).toEqual({ built: 2, ended: 2 });
  expect(offending(requests)).toEqual([]);
});

test('pdf-text-metadata: a page list written wrongly is reported before the file is opened, so a locked file still gets the list message', async ({
  page,
}) => {
  await openTool(page, 'pdf-text-metadata');
  const requests = recordRequests(page);
  await attachFile(page, pdfFile('locked.pdf', USER_PASSWORD_PDF));
  await fillField(page, 'pages', '3-1');
  await runButtonOf(page).click();
  // The list is wrong whatever the file holds, so it is reported first; the file's password is never asked about.
  await expect(outputArea(page).locator('.issue-list')).toContainText('goes backwards', { timeout: 15_000 });
  await expect(outputArea(page).locator('.issue-list')).not.toContainText('needs a password');
  // A list that is written correctly is judged with the file: the locked file gets its own sentence.
  await fillField(page, 'pages', '1');
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('.issue-list')).toContainText(
    'This PDF needs a password, which this page cannot use.',
    { timeout: 30_000 },
  );
  expect(offending(requests)).toEqual([]);
});

/**
 * Hostile PDFs, written here from ISO 32000-1:2008 sections 7.3 (objects), 7.4.4 (FlateDecode), 7.5 (file structure) and
 * 8.10 (form XObjects) with Node's own zlib, so no binary fixture is committed. Each is small on disk: the three that
 * expand hold 100 MiB of zeros once decoded in 100 KB, and the one made of forms drawing forms is under 4 KB.
 */
interface RawObject {
  number: number;
  body: Buffer;
}

function rawPdf(objects: RawObject[]): Buffer {
  let out = Buffer.from('%PDF-1.5\n', 'latin1');
  const offsets = new Map<number, number>();
  for (const { number, body } of objects) {
    offsets.set(number, out.length);
    out = Buffer.concat([out, Buffer.from(`${number} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
  }
  const size = Math.max(...objects.map((o) => o.number)) + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let n = 1; n < size; n++) {
    const at = offsets.get(n);
    xref += at === undefined ? '0000000000 00000 f \n' : `${String(at).padStart(10, '0')} 00000 n \n`;
  }
  return Buffer.concat([
    out,
    Buffer.from(`${xref}trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${out.length}\n%%EOF\n`, 'latin1'),
  ]);
}

function streamBody(dictionary: string, data: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`, 'latin1'),
    data,
    Buffer.from('\nendstream', 'latin1'),
  ]);
}

const CATALOG_OBJECT: RawObject = { number: 1, body: Buffer.from('<< /Type /Catalog /Pages 2 0 R >>') };
const HELVETICA_OBJECT: RawObject = {
  number: 5,
  body: Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
};

/** Three files that expand to 100 MiB when their streams are decoded, which is past the 64 MiB one stream may reach. */
function expandingPdf(kind: 'object-stream' | 'content-stream' | 'doubled-filter'): PickedFile {
  const zeros = Buffer.alloc(100 * 1024 * 1024);
  const pages: RawObject = { number: 2, body: Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>') };
  if (kind === 'object-stream') {
    const flate = deflateSync(Buffer.concat([Buffer.from('10 0 (x) '), zeros]));
    const page: RawObject = {
      number: 3,
      body: Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>'),
    };
    const objectStream = streamBody('/Type /ObjStm /N 1 /First 5 /Filter /FlateDecode', flate);
    return {
      name: 'expands-objstm.pdf',
      mimeType: 'application/pdf',
      buffer: rawPdf([CATALOG_OBJECT, pages, page, { number: 6, body: objectStream }]),
    };
  }
  const page: RawObject = {
    number: 3,
    body: Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    ),
  };
  const content = Buffer.concat([Buffer.from('BT /F1 12 Tf 10 10 Td (hello) Tj ET\n'), zeros]);
  const data = kind === 'content-stream' ? deflateSync(content) : deflateSync(deflateSync(content));
  const filter = kind === 'content-stream' ? '/Filter /FlateDecode' : '/Filter [/FlateDecode /FlateDecode]';
  return {
    name: `expands-${kind}.pdf`,
    mimeType: 'application/pdf',
    buffer: rawPdf([CATALOG_OBJECT, pages, page, { number: 4, body: streamBody(filter, data) }, HELVETICA_OBJECT]),
  };
}

/**
 * A file of two pages. Page one holds one line of text. Page two draws a form that draws a form ten times, `depth` levels
 * down, and the innermost form shows `text` in a font small enough to fit, so a page of `10 ** depth` items comes from a
 * file of a few kilobytes. (Review probe: five levels were 100,000 items and about eleven seconds in Node.)
 */
function nestedFormsPdf(depth: number, text: string, firstPage = true): PickedFile {
  const objects: RawObject[] = [
    CATALOG_OBJECT,
    {
      number: 2,
      body: Buffer.from(`<< /Type /Pages /Kids [${firstPage ? '3 0 R ' : ''}6 0 R] /Count ${firstPage ? 2 : 1} >>`),
    },
    {
      number: 3,
      body: Buffer.from(
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      ),
    },
    { number: 4, body: streamBody('', Buffer.from('BT /F1 12 Tf 10 100 Td (FODT-FIRST-PAGE) Tj ET')) },
    HELVETICA_OBJECT,
    {
      number: 6,
      body: Buffer.from(
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 7 0 R /Resources << /XObject << /X0 10 0 R >> /Font << /F1 5 0 R >> >> >>',
      ),
    },
    { number: 7, body: streamBody('', Buffer.from('/X0 Do')) },
  ];
  for (let level = 0; level <= depth; level++) {
    const content =
      level === depth
        ? `BT /F1 0.5 Tf 0 0 Td (${text}) Tj ET`
        : Array.from({ length: 10 }, () => `/X${level + 1} Do`).join('\n');
    objects.push({
      number: 10 + level,
      body: streamBody(
        `/Type /XObject /Subtype /Form /BBox [0 0 200 200] /Resources << /XObject << /X${level + 1} ${11 + level} 0 R >> /Font << /F1 5 0 R >> >>`,
        Buffer.from(content),
      ),
    });
  }
  return { name: `forms-${depth}.pdf`, mimeType: 'application/pdf', buffer: rawPdf(objects) };
}

const EXPANSION_MESSAGE = 'This PDF expands to more data than this page can hold in memory.';

test('pdf-text-metadata: a small file that expands past the memory cap is refused in every mode before PDF.js is built', async ({
  page,
}) => {
  await slowPdfWorker(page, 0);
  await openTool(page, 'pdf-text-metadata');
  const requests = recordRequests(page);
  let first = true;
  for (const kind of ['object-stream', 'content-stream', 'doubled-filter'] as const) {
    const file = expandingPdf(kind);
    expect(file.buffer.length, `${kind} is small on disk`).toBeLessThan(400 * 1024);
    await attachFile(page, file);
    for (const mode of ['text', 'metadata', 'remove'] as const) {
      await chooseMode(page, mode);
      await runButtonOf(page).click();
      await expect(outputArea(page).locator('.issue-list'), `${kind} in ${mode} mode`).toContainText(
        EXPANSION_MESSAGE,
        {
          timeout: 30_000,
        },
      );
      expect(await outputArea(page).locator('pre.output').count()).toBe(0);
      expect(await outputArea(page).getByRole('button', { name: 'Download' }).count()).toBe(0);
      if (first) {
        // Reading and metadata never built PDF.js's worker; Remove built its own one and ended it.
        const expected = mode === 'remove' ? { built: 1, ended: 1 } : { built: 0, ended: 0 };
        await expect.poll(() => workerCounts(page)).toEqual(expected);
      }
    }
    first = false;
  }
  // The page stays usable: an ordinary file reads on the same page afterwards.
  await attachFile(page, pdfFile('ordinary.pdf', TAGGED_PDF));
  await chooseMode(page, 'text');
  await runButtonOf(page).click();
  await expect(outputArea(page)).toContainText('--- Page 1 ---', { timeout: 30_000 });
  expect(offending(requests)).toEqual([]);
});

test('pdf-text-metadata: a small file whose forms draw each other into millions of characters stops at the text budget with a note', async ({
  page,
}) => {
  await openTool(page, 'pdf-text-metadata');
  await attachFile(page, nestedFormsPdf(4, 'A'.repeat(400)));
  await runButtonOf(page).click();
  await expect(outputArea(page)).toContainText('Text stops at 2,000,000 characters', { timeout: 40_000 });
  await expect(outputArea(page).locator('.stats')).toContainText('Characters 2000000');
  await expect(outputArea(page)).toContainText('--- Page 1 ---');
  expect(await outputArea(page).locator('.issue-list').count()).toBe(0);
});

test('pdf-text-metadata: a heavy page that stalls the read after the first page stops with the plain message and the next file reads', async ({
  page,
}) => {
  // Page one is read at once; page two is a file of forms drawing forms six levels down (a million draws of one letter, far
  // more than any engine finishes in three seconds and far too few letters to reach the text budget), so the read stalls
  // in the middle of the run, after the page that was already read.
  await slowPdfWorker(page, 0, 3_000);
  await openTool(page, 'pdf-text-metadata');
  const requests = recordRequests(page);
  await attachFile(page, nestedFormsPdf(6, 'A'));
  await runButtonOf(page).click();
  await expect(page.locator('.field-help', { hasText: 'Page 1 of 2' })).toBeVisible({ timeout: 15_000 });
  await expect(outputArea(page).locator('.issue-list')).toContainText(
    'Stopped after 20 seconds without progress. The file may be unusually large or complex for this browser.',
    { timeout: 15_000 },
  );
  expect(await outputArea(page).locator('pre.output').count()).toBe(0);
  await expect.poll(() => workerCounts(page)).toEqual({ built: 1, ended: 1 });

  // With the limit lifted, an ordinary file reads in full on a new worker.
  await page.evaluate(() => {
    window.__FODT_PDF_TEXT_METADATA_TEST_STALL_MS__ = 0;
  });
  await attachFile(page, pdfFile('ordinary.pdf', TAGGED_PDF));
  await runButtonOf(page).click();
  await expect(outputArea(page)).toContainText('--- Page 3 ---', { timeout: 30_000 });
  await expect.poll(() => workerCounts(page)).toEqual({ built: 2, ended: 2 });
  expect(offending(requests)).toEqual([]);
});

/**
 * QR Code & Barcode Reader, picked files (review of phase 15, part A). Pictures are made here: the PNG writer of
 * ./fixture-files draws a QR code from its module matrix (made with the qrcode 1.5.4 library from the reader folder, level
 * M, one 1 per dark module), the browser's own canvas writes the JPEG, and the refused files are a few bytes of header.
 */
const QR_WORKER_MATRIX = [
  '111111101010101111111',
  '100000101100001000001',
  '101110100101101011101',
  '101110101100001011101',
  '101110100011001011101',
  '100000100111101000001',
  '111111101010101111111',
  '000000001101100000000',
  '101101110101101001011',
  '100111011110110101111',
  '101101100101000011000',
  '110001001110011001101',
  '101111111110110100101',
  '000000001000011000100',
  '111111101010011111010',
  '100000101001111011010',
  '101110100111100000000',
  '101110101000110101010',
  '101110101010001101100',
  '100000100100011011000',
  '111111101000111001010',
];

/**
 * A QR code whose text is FODT-HOSTILE-, U+202E, gpj.exe, U+200B, U+0007, x, the tag character U+E0041, U+FEFF and end.
 *   cd tools/qr-barcode-reader && node -e "const Q=require('qrcode');const t='FODT-HOSTILE-'+String.fromCodePoint(0x202e)+
 *   'gpj.exe'+String.fromCodePoint(0x200b)+String.fromCodePoint(7)+'x'+String.fromCodePoint(0xe0041)+
 *   String.fromCodePoint(0xfeff)+'end';const q=Q.create(t,{errorCorrectionLevel:'M'});const n=q.modules.size;
 *   for(let r=0;r<n;r++){let s='';for(let c=0;c<n;c++)s+=q.modules.data[r*n+c];console.log(s)}"
 */
const QR_HOSTILE_MATRIX = [
  '11111110110110100011101111111',
  '10000010010100000001101000001',
  '10111010010011011100101011101',
  '10111010111010111110101011101',
  '10111010100111110101101011101',
  '10000010111001101011001000001',
  '11111110101010101010101111111',
  '00000000111000101101100000000',
  '10001011110001101110111111001',
  '10010001111110011100100011110',
  '10101010101001110000101101000',
  '00011101111001001011001000101',
  '00110111111011010001110111011',
  '11010001101101110011011011100',
  '00010110010010010011111010100',
  '10011100101100101011000010111',
  '01000111101011111010100011010',
  '10010101011000011100111100111',
  '00001010100001100110110101010',
  '00111001110011010111000100000',
  '11001011101111011011111111001',
  '00000000100001101010100011001',
  '11111110111100000111101011110',
  '10000010011100110101100011010',
  '10111010100111111011111110010',
  '10111010011011011110101000100',
  '10111010001010010110011111111',
  '10000010010000000101011101110',
  '11111110100010010010111110000',
];

function qrPngOf(name: string, matrix: string[]): PickedFile {
  const scale = 8;
  const margin = 4;
  const size = matrix.length;
  const side = (size + margin * 2) * scale;
  const rgba = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) {
    const row = Math.floor(y / scale) - margin;
    for (let x = 0; x < side; x++) {
      const col = Math.floor(x / scale) - margin;
      const dark = row >= 0 && row < size && col >= 0 && col < size && matrix[row]![col] === '1';
      const o = (y * side + x) * 4;
      const value = dark ? 0 : 255;
      rgba[o] = value;
      rgba[o + 1] = value;
      rgba[o + 2] = value;
      rgba[o + 3] = 255;
    }
  }
  return { name, mimeType: 'image/png', buffer: Buffer.from(writePng(side, side, rgba)) };
}

/** The first bytes of an image file that declare a size and hold nothing else. */
function headerOnly(
  kind: 'png' | 'bmp' | 'gif',
  fields: { width: number; height: number; frame?: [number, number] },
): Buffer {
  if (kind === 'png') {
    const bytes = Buffer.alloc(33);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(bytes);
    bytes.writeUInt32BE(fields.width, 16);
    bytes.writeUInt32BE(fields.height, 20);
    bytes.set([8, 6, 0, 0, 0], 24);
    return bytes;
  }
  if (kind === 'bmp') {
    const bytes = Buffer.alloc(54);
    bytes.write('BM', 0, 'latin1');
    bytes.writeUInt32LE(54, 10);
    bytes.writeUInt32LE(40, 14);
    bytes.writeInt32LE(fields.width, 18);
    bytes.writeInt32LE(fields.height, 22);
    bytes.writeUInt16LE(1, 26);
    bytes.writeUInt16LE(24, 28);
    return bytes;
  }
  // A GIF whose logical screen is `width` by `height` and whose first image descriptor, when `frame` is given, is larger.
  const parts = [Buffer.from('GIF89a', 'latin1'), Buffer.alloc(7)];
  parts[1]!.writeUInt16LE(fields.width, 0);
  parts[1]!.writeUInt16LE(fields.height, 2);
  if (fields.frame) {
    const descriptor = Buffer.alloc(10);
    descriptor[0] = 0x2c;
    descriptor.writeUInt16LE(fields.frame[0], 5);
    descriptor.writeUInt16LE(fields.frame[1], 7);
    parts.push(descriptor);
  }
  return Buffer.concat(parts);
}

test('qr-barcode-reader: a text file, an oversized picture, a picture with a negative size and a GIF that grows past its screen are refused before decoding', async ({
  page,
}) => {
  await openTool(page, 'qr-barcode-reader');
  const requests = recordRequests(page);
  const marker = 'FODT-MARKER-NOT-IN-MESSAGES';
  const cases: { file: PickedFile; message: string }[] = [
    {
      file: {
        name: 'notes.png',
        mimeType: 'image/png',
        buffer: Buffer.from(`plain text, not a picture ${marker}`),
      },
      message: 'This is not a PNG, JPEG, GIF, WebP or BMP image.',
    },
    {
      file: { name: 'huge.png', mimeType: 'image/png', buffer: headerOnly('png', { width: 100_000, height: 100_000 }) },
      message: 'declares more than 50,000,000 pixels',
    },
    {
      file: {
        name: 'negative.bmp',
        mimeType: 'image/bmp',
        buffer: headerOnly('bmp', { width: -100_000, height: 100_000 }),
      },
      message: 'The size of this image could not be read from its header.',
    },
    {
      file: { name: 'zero.png', mimeType: 'image/png', buffer: headerOnly('png', { width: 0, height: 20 }) },
      message: 'The size of this image could not be read from its header.',
    },
    {
      // A one pixel screen whose first frame is 65535 by 65535: some engines grow the picture to the frame.
      file: {
        name: 'grows.gif',
        mimeType: 'image/gif',
        buffer: headerOnly('gif', { width: 1, height: 1, frame: [65535, 65535] }),
      },
      message: 'declares more than 50,000,000 pixels',
    },
  ];
  for (const { file, message } of cases) {
    await attachFile(page, file);
    await runButtonOf(page).click();
    await expect(outputArea(page).locator('.issue-list'), file.name).toContainText(message, { timeout: 15_000 });
    await expect(outputArea(page).locator('.issue-list')).not.toContainText(marker);
    expect(await outputArea(page).locator('pre.output').count(), file.name).toBe(0);
  }
  expect(offending(requests)).toEqual([]);
});

test('qr-barcode-reader: a JPEG with more than 64 KB of header segments before its frame is read, not refused as not an image', async ({
  page,
}) => {
  await openTool(page, 'qr-barcode-reader');
  const requests = recordRequests(page);
  // The browser writes the JPEG of the code (JPEG is the one format every engine can encode), and 70 KB of application
  // segments are put in front of everything else, as an ICC profile, XMP and an editing program's data are on a real photo.
  const base = qrPngOf('worker-check.png', QR_WORKER_MATRIX);
  const jpegBase64 = await page.evaluate(async (pngBase64) => {
    const bytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.95).split(',')[1]!;
  }, base.buffer.toString('base64'));
  const jpeg = Buffer.from(jpegBase64, 'base64');
  expect(jpeg.subarray(0, 2).toString('hex')).toBe('ffd8');
  const segments: Buffer[] = [];
  for (let left = 70_000; left > 0;) {
    const payload = Math.min(left, 35_000);
    const segment = Buffer.alloc(4 + payload);
    segment[0] = 0xff;
    segment[1] = 0xe1;
    segment.writeUInt16BE(payload + 2, 2);
    segments.push(segment);
    left -= payload;
  }
  const big = Buffer.concat([jpeg.subarray(0, 2), ...segments, jpeg.subarray(2)]);
  expect(big.length).toBeGreaterThan(70_000);
  await attachFile(page, { name: 'big-header.jpg', mimeType: 'image/jpeg', buffer: big });
  await runButtonOf(page).click();
  await expect(outputArea(page)).toContainText('FODT-VISION-WORKER', { timeout: 30_000 });
  await expect(outputArea(page).locator('.issue-list')).toHaveCount(0);
  expect(offending(requests)).toEqual([]);
});

test('qr-barcode-reader: decoded text with direction, control, invisible and tag characters is shown only as escapes', async ({
  page,
}) => {
  await openTool(page, 'qr-barcode-reader');
  const requests = recordRequests(page);
  await attachFile(page, qrPngOf('hostile.png', QR_HOSTILE_MATRIX));
  await runButtonOf(page).click();
  const output = outputArea(page);
  await expect(output).toContainText('FODT-HOSTILE-', { timeout: 30_000 });
  const backslash = String.fromCharCode(92);
  const shown = await output.innerText();
  for (const escape of ['202E', '200B', 'E0041', 'FEFF']) {
    expect(shown, `the escape of U+${escape}`).toContain(`${backslash}u{${escape}}`);
  }
  // The engine's own text mode writes a control character such as BEL as <BEL> before the page sees it, so the page's escape
  // for it is the second line of defence; either way no raw control character reaches the page.
  expect(shown.includes(`${backslash}u{7}`) || shown.includes('<BEL>')).toBe(true);
  // None of the characters themselves reached the page: not in the table and not in the block of text.
  const raw = [0x202e, 0x200b, 0x07, 0xfeff, 0xe0041].map((cp) => String.fromCodePoint(cp));
  const html = await output.innerHTML();
  for (const character of raw) {
    expect(html.includes(character), `U+${character.codePointAt(0)!.toString(16)} in the page`).toBe(false);
  }
  // The harmless words around them are still readable.
  expect(shown).toContain('gpj.exe');
  expect(shown).toContain('end');
  expect(offending(requests)).toEqual([]);
});

/**
 * Image Diff & Compare (plan 15-05). Pictures are made here, pixel by pixel, with the PNG writer of ./fixture-files, and
 * what the page says is checked against what was drawn: the count of pixels made to differ, the share worked out by hand
 * from it, and the decoded difference picture read pixel by pixel in the page. Encoders differ between browsers, so only
 * decoded pixels and numbers are compared, never the bytes or sizes of a PNG.
 */
function drawnPng(name: string, width: number, height: number, black: Set<string> = new Set()): PickedFile {
  const rgba = new Uint8Array(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (black.has(`${x},${y}`)) rgba.set([0, 0, 0, 255], (y * width + x) * 4);
    }
  }
  return { name, mimeType: 'image/png', buffer: Buffer.from(writePng(width, height, rgba)) };
}

/** Attaches a file to the named file field, repeating until the page shows the file's name under it. */
async function attachImage(page: Page, field: string, file: PickedFile): Promise<void> {
  await expect(async () => {
    await page.locator(`#f-${field}`).setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
    await expect(page.locator('.field-help', { hasText: file.name })).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

/** Decodes a PNG in the page and lists the places where a pixel is exactly red (255, 0, 0, 255), as x,y, and one gray sample. */
async function decodeDiff(
  page: Page,
  base64: string,
): Promise<{ width: number; height: number; red: string[]; topLeft: number[] }> {
  return page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const red: string[] = [];
    for (let i = 0; i < bitmap.width * bitmap.height; i++) {
      if (pixels[i * 4] === 255 && pixels[i * 4 + 1] === 0 && pixels[i * 4 + 2] === 0 && pixels[i * 4 + 3] === 255) {
        red.push(`${i % bitmap.width},${Math.floor(i / bitmap.width)}`);
      }
    }
    return { width: bitmap.width, height: bitmap.height, red, topLeft: Array.from(pixels.slice(0, 4)) };
  }, base64);
}

/** The difference picture the page shows, decoded the way a visitor's own browser draws it. */
async function shownDiff(page: Page) {
  const src = await outputArea(page).locator('img').first().getAttribute('src');
  expect(src?.startsWith('data:image/png;base64,')).toBe(true);
  return decodeDiff(page, src!.slice('data:image/png;base64,'.length));
}

test('image-compare: two images made in the test give the exact differing count, the share and red pixels exactly where they differ', async ({
  page,
}) => {
  await openTool(page, 'image-compare');
  // Recorded only after the page and its own chunk have loaded, so this asserts nothing is requested while comparing.
  const requests = recordRequests(page);

  // Two 20 by 10 pictures, both white, the second with a black pixel at seven places that are not next to each other.
  const black = ['1,1', '5,1', '9,1', '13,1', '17,1', '3,6', '11,6'];
  await attachImage(page, 'imageA', drawnPng('first.png', 20, 10));
  await attachImage(page, 'imageB', drawnPng('second.png', 20, 10, new Set(black)));
  await fillField(page, 'threshold', '0.1');
  await runButtonOf(page).click();

  // Seven of 200 pixels differ, and 7 / 200 is 3.5 %, shown to two decimals.
  const result = outputArea(page).locator('dl.kv');
  await expect(result).toContainText('7 of 200', { timeout: 30_000 });
  await expect(result).toContainText('3.50 %');
  await expect(result).toContainText('20 by 10 pixels');

  // The difference picture is red at exactly those seven places and nowhere else; a matching pixel is gray (white blended
  // with white is white).
  const shown = await shownDiff(page);
  expect([shown.width, shown.height]).toEqual([20, 10]);
  expect([...shown.red].sort()).toEqual([...black].sort());
  expect(shown.topLeft).toEqual([255, 255, 255, 255]);

  // The downloaded file is the same picture.
  const file = await downloadCopy(page);
  expect(file.name).toBe('diff.png');
  const downloaded = await decodeDiff(page, file.bytes.toString('base64'));
  expect([downloaded.width, downloaded.height]).toEqual([20, 10]);
  expect([...downloaded.red].sort()).toEqual([...black].sort());

  // At the largest threshold a black pixel against a white one is not a difference (its colour distance is 32857, below
  // the 35215 that threshold 1 allows), so nothing is counted and the share is 0.00 %.
  await fillField(page, 'threshold', '1');
  await runButtonOf(page).click();
  await expect(result).toContainText('0 of 200', { timeout: 15_000 });
  await expect(result).toContainText('0.00 %');
  expect((await shownDiff(page)).red).toEqual([]);

  // A threshold outside 0 to 1 is refused, naming the field.
  await fillField(page, 'threshold', '-5');
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('.issue-list')).toContainText('Threshold', { timeout: 15_000 });

  expect(offending(requests)).toEqual([]);
});

test('image-compare: images of different sizes are refused by default and padded when asked', async ({ page }) => {
  await openTool(page, 'image-compare');
  const requests = recordRequests(page);

  // A white 20 by 10 picture against a white 20 by 12 one.
  await attachImage(page, 'imageA', drawnPng('short.png', 20, 10));
  await attachImage(page, 'imageB', drawnPng('tall.png', 20, 12));
  await fillField(page, 'threshold', '0.1');
  await runButtonOf(page).click();

  // Refused by default, with both sizes named, and nothing is compared.
  const issues = outputArea(page).locator('.issue-list');
  await expect(issues).toContainText('first is 20 by 10 pixels', { timeout: 30_000 });
  await expect(issues).toContainText('second is 20 by 12 pixels');
  expect(await outputArea(page).locator('dl.kv').count()).toBe(0);

  // Padded: the short picture grows to 20 by 12 with transparent pixels in its two new rows, so exactly those 2 rows of
  // 20 pixels (40 of 240) differ from the white ones, and 40 / 240 is 16.67 %.
  await page.locator('#f-onSizeMismatch').selectOption('pad');
  await runButtonOf(page).click();
  const result = outputArea(page).locator('dl.kv');
  await expect(result).toContainText('40 of 240', { timeout: 30_000 });
  await expect(result).toContainText('16.67 %');
  await expect(result).toContainText('20 by 12 pixels');
  await expect(outputArea(page)).toContainText('padded with transparent pixels');

  const shown = await shownDiff(page);
  expect([shown.width, shown.height]).toEqual([20, 12]);
  const padded: string[] = [];
  for (const y of [10, 11]) for (let x = 0; x < 20; x++) padded.push(`${x},${y}`);
  expect([...shown.red].sort()).toEqual([...padded].sort());
  expect(shown.topLeft).toEqual([255, 255, 255, 255]);

  // Choosing Refuse again refuses again: the choice is read each run.
  await page.locator('#f-onSizeMismatch').selectOption('refuse');
  await runButtonOf(page).click();
  await expect(issues).toContainText('first is 20 by 10 pixels', { timeout: 15_000 });
  expect(await outputArea(page).locator('dl.kv').count()).toBe(0);

  expect(offending(requests)).toEqual([]);
});

/**
 * Sprite Sheet Generator (plan 15-06). Pictures are made here with a different opaque colour in every pixel (the colour is
 * a bijection of the pixel's number, so no two pixels of any picture share a colour), and what the page produces is
 * checked three ways, never against the page's own earlier output:
 *   1. the downloaded sheet, decoded in the page, holds each picture's exact pixels at the position the table states, and
 *      is transparent everywhere else;
 *   2. the downloaded CSS is the exact text the layout rules call for;
 *   3. applied in a blank page with the sheet as a data address, each rule shows its picture as a browser renders it:
 *      the element is compared pixel for pixel with an element that shows the picture's own file the same way, and (in
 *      every engine whose renderer does not move colour values) with the pixels that were drawn.
 */
interface DistinctPicture {
  file: PickedFile;
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** A colour for pixel `index` of picture `pic`: the three bytes of (a number unique to the pixel) times an odd constant, mod 2^24. */
function distinctColour(pic: number, index: number): [number, number, number] {
  const n = (((pic + 1) * 100_000 + index) * 40503) % 16_777_216;
  return [n & 255, (n >> 8) & 255, (n >> 16) & 255];
}

function distinctPng(name: string, width: number, height: number, pic: number): DistinctPicture {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([...distinctColour(pic, i), 255], i * 4);
  return {
    file: { name, mimeType: 'image/png', buffer: Buffer.from(writePng(width, height, rgba)) },
    width,
    height,
    rgba,
  };
}

/** Attaches several files to a multiple file field, repeating until the page shows the first name and the count. */
async function attachMany(page: Page, field: string, list: PickedFile[]): Promise<void> {
  await expect(async () => {
    await page
      .locator(`#f-${field}`)
      .setInputFiles(list.map((f) => ({ name: f.name, mimeType: f.mimeType, buffer: f.buffer })));
    await expect(page.locator('.field-help', { hasText: list[0]!.name })).toBeVisible({ timeout: 500 });
    if (list.length > 1) {
      await expect(page.locator('.field-help', { hasText: `and ${list.length - 1} more` })).toBeVisible({
        timeout: 500,
      });
    }
  }).toPass({ timeout: 10_000 });
}

/** Clicks Download beside the named file in the output's file list and returns what was saved. */
async function downloadNamed(page: Page, name: string): Promise<Buffer> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    outputArea(page).locator('li', { hasText: name }).getByRole('button', { name: 'Download' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(name);
  return readFileSync(await download.path());
}

/** Decodes PNG bytes in the page and returns every pixel as RGBA numbers. */
async function decodeRgba(
  page: Page,
  base64: string,
  mime = 'image/png',
): Promise<{ width: number; height: number; data: number[] }> {
  return page.evaluate(
    async ([data, type]) => {
      const bytes = Uint8Array.from(atob(data!), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: type! }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      return {
        width: bitmap.width,
        height: bitmap.height,
        data: Array.from(context.getImageData(0, 0, bitmap.width, bitmap.height).data),
      };
    },
    [base64, mime],
  );
}

interface ExpectedSprite {
  className: string;
  x: number;
  y: number;
}

/** The sprites of the table, as [class, x, y, width, height] text rows. */
async function spriteRows(page: Page): Promise<string[][]> {
  return outputArea(page)
    .locator('table.output-table tbody tr')
    .evaluateAll((rows) => rows.map((row) => Array.from(row.querySelectorAll('td'), (cell) => cell.textContent ?? '')));
}

/**
 * Proves one run of the page: the table, the sheet's pixels, the CSS text and the rendering through the CSS. `context` is
 * a browser context at a device scale of 1, so an element's screenshot has exactly one pixel per CSS pixel.
 */
async function proveSprites(
  page: Page,
  context: BrowserContext,
  pictures: DistinctPicture[],
  expected: ExpectedSprite[],
  sheet: { width: number; height: number },
  expectedCss: string,
  engine: string,
): Promise<void> {
  // The table lists every sprite with its class, position and size.
  expect(await spriteRows(page)).toEqual(
    pictures.map((p, i) => [
      expected[i]!.className,
      String(expected[i]!.x),
      String(expected[i]!.y),
      String(p.width),
      String(p.height),
    ]),
  );

  // 1. The sheet: each picture's exact pixels at its position, transparent everywhere else.
  const sheetBytes = await downloadNamed(page, 'sprite.png');
  const decoded = await decodeRgba(page, sheetBytes.toString('base64'));
  expect([decoded.width, decoded.height]).toEqual([sheet.width, sheet.height]);
  const covered = new Set<number>();
  pictures.forEach((p, i) => {
    const at = expected[i]!;
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const o = ((at.y + y) * decoded.width + at.x + x) * 4;
        covered.add(o);
        expect(decoded.data.slice(o, o + 4)).toEqual(
          Array.from(p.rgba.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4)),
        );
      }
    }
  });
  for (let o = 0; o < decoded.data.length; o += 4) {
    if (!covered.has(o)) expect(decoded.data[o + 3]).toBe(0);
  }

  // 2. The CSS: the exact text, the same in the code block and in the download.
  const cssFile = (await downloadNamed(page, 'sprite.css')).toString('utf8');
  expect(cssFile).toBe(expectedCss);
  expect(await codeText(page)).toBe(expectedCss);

  // 3. Rendering: the CSS applied in a blank page with the sheet as a data address.
  const blank = await context.newPage();
  try {
    await blank.goto('about:blank');
    const sheetUrl = `data:image/png;base64,${sheetBytes.toString('base64')}`;
    await blank.evaluate(
      ({ css, url, sources, classes, sizes }) => {
        document.body.style.margin = '0';
        const style = document.createElement('style');
        style.textContent = css.replace('url(sprite.png)', `url(${url})`);
        document.head.append(style);
        classes.forEach((name, i) => {
          const spriteBox = document.createElement('div');
          spriteBox.style.cssText = `position:absolute;line-height:0;left:${10 + i * 60}px;top:10px`;
          const sprite = document.createElement('span');
          sprite.className = `sprite ${name}`;
          sprite.id = `sprite-${i}`;
          spriteBox.append(sprite);
          document.body.append(spriteBox);
          // The same picture's own file, shown the same way (a background of the element's size).
          const reference = document.createElement('div');
          reference.id = `reference-${i}`;
          reference.style.cssText = `position:absolute;left:${10 + i * 60}px;top:100px;width:${sizes[i]![0]}px;height:${sizes[i]![1]}px;background:url(data:image/png;base64,${sources[i]}) 0 0 no-repeat`;
          document.body.append(reference);
        });
      },
      {
        css: cssFile,
        url: sheetUrl,
        sources: pictures.map((p) => p.file.buffer.toString('base64')),
        classes: expected.map((e) => e.className),
        sizes: pictures.map((p) => [p.width, p.height]),
      },
    );
    for (let i = 0; i < pictures.length; i++) {
      const p = pictures[i]!;
      const shown = await decodeRgba(blank, (await blank.locator(`#sprite-${i}`).screenshot()).toString('base64'));
      const reference = await decodeRgba(
        blank,
        (await blank.locator(`#reference-${i}`).screenshot()).toString('base64'),
      );
      expect([shown.width, shown.height]).toEqual([p.width, p.height]);
      // Each rule shows exactly what the picture's own file shows, in the same browser.
      expect(shown.data).toEqual(reference.data);
      // And what was drawn. WebKit's renderer, here, moves some single channel values by one even when it shows the picture
      // alone (the reference above), so there the bound is one step; every other engine must match exactly.
      const drawn = Array.from(p.rgba);
      if (engine === 'webkit') {
        const worst = shown.data.reduce((m, v, k) => Math.max(m, Math.abs(v - drawn[k]!)), 0);
        expect(worst).toBeLessThanOrEqual(1);
      } else {
        expect(shown.data).toEqual(drawn);
      }
    }
  } finally {
    await blank.close();
  }
}

test('sprite-sheet: each generated rule shows its own image pixel for pixel in a blank page', async ({
  page,
  browser,
  browserName,
}) => {
  await openTool(page, 'sprite-sheet');
  // Recorded only after the page and its own chunk have loaded, so this asserts nothing is requested while packing.
  const requests = recordRequests(page);
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  try {
    // Three pictures of 10 by 10, 20 by 5 and 5 by 30, every pixel a different opaque colour.
    const pictures = [
      distinctPng('pic-1.png', 10, 10, 0),
      distinctPng('pic-2.png', 20, 5, 1),
      distinctPng('pic-3.png', 5, 30, 2),
    ];
    await attachMany(
      page,
      'images',
      pictures.map((p) => p.file),
    );
    await fillField(page, 'padding', '2');
    await runButtonOf(page).click();
    await expect(outputArea(page).locator('table.output-table')).toBeVisible({ timeout: 30_000 });
    await expect(outputArea(page).locator('.stats')).toContainText('42 by 62 pixels');

    // Grid, padding 2: two columns, cells of 20 by 30, so the pictures sit at 0 0, 22 0 and 0 32 on a 42 by 62 sheet.
    const gridCss = [
      '.sprite {',
      '  display: inline-block;',
      '  background-image: url(sprite.png);',
      '  background-repeat: no-repeat;',
      '}',
      '',
      '.sprite-pic-1 {',
      '  background-position: 0 0;',
      '  width: 10px;',
      '  height: 10px;',
      '}',
      '',
      '.sprite-pic-2 {',
      '  background-position: -22px 0;',
      '  width: 20px;',
      '  height: 5px;',
      '}',
      '',
      '.sprite-pic-3 {',
      '  background-position: 0 -32px;',
      '  width: 5px;',
      '  height: 30px;',
      '}',
      '',
    ].join('\n');
    await proveSprites(
      page,
      context,
      pictures,
      [
        { className: 'sprite-pic-1', x: 0, y: 0 },
        { className: 'sprite-pic-2', x: 22, y: 0 },
        { className: 'sprite-pic-3', x: 0, y: 32 },
      ],
      { width: 42, height: 62 },
      gridCss,
      browserName,
    );

    // Shelf, padding 2: the 30 tall picture first, then the 10 tall, then the 5 tall, wrapping at a width of 20, so the
    // pictures sit at 7 0, 0 32 and 0 0 on a 20 by 37 sheet.
    await page.locator('input[name="layout"][value="shelf"]').click();
    await runButtonOf(page).click();
    await expect(outputArea(page).locator('.stats')).toContainText('20 by 37 pixels', { timeout: 30_000 });
    const shelfCss = [
      '.sprite {',
      '  display: inline-block;',
      '  background-image: url(sprite.png);',
      '  background-repeat: no-repeat;',
      '}',
      '',
      '.sprite-pic-1 {',
      '  background-position: -7px 0;',
      '  width: 10px;',
      '  height: 10px;',
      '}',
      '',
      '.sprite-pic-2 {',
      '  background-position: 0 -32px;',
      '  width: 20px;',
      '  height: 5px;',
      '}',
      '',
      '.sprite-pic-3 {',
      '  background-position: 0 0;',
      '  width: 5px;',
      '  height: 30px;',
      '}',
      '',
    ].join('\n');
    await proveSprites(
      page,
      context,
      pictures,
      [
        { className: 'sprite-pic-1', x: 7, y: 0 },
        { className: 'sprite-pic-2', x: 0, y: 32 },
        { className: 'sprite-pic-3', x: 0, y: 0 },
      ],
      { width: 20, height: 37 },
      shelfCss,
      browserName,
    );

    // With padding 0 in a grid, neighbouring sprites touch: 10 by 10 pictures sit at 0 0, 10 0 and 0 10 on a 20 by 20 sheet.
    const squares = [
      distinctPng('sq-1.png', 10, 10, 3),
      distinctPng('sq-2.png', 10, 10, 4),
      distinctPng('sq-3.png', 10, 10, 5),
    ];
    await attachMany(
      page,
      'images',
      squares.map((p) => p.file),
    );
    await page.locator('input[name="layout"][value="grid"]').click();
    await fillField(page, 'padding', '0');
    await runButtonOf(page).click();
    await expect(outputArea(page).locator('.stats')).toContainText('20 by 20 pixels', { timeout: 30_000 });
    expect(await spriteRows(page)).toEqual([
      ['sprite-sq-1', '0', '0', '10', '10'],
      ['sprite-sq-2', '10', '0', '10', '10'],
      ['sprite-sq-3', '0', '10', '10', '10'],
    ]);
    const touching = await decodeRgba(page, (await downloadNamed(page, 'sprite.png')).toString('base64'));
    // The three pictures fill 300 pixels with no gap between them; the fourth cell of the 2 by 2 grid is empty (100 pixels).
    const alphas = touching.data.filter((_, k) => k % 4 === 3);
    expect(alphas.filter((alpha) => alpha === 255)).toHaveLength(300);
    expect(alphas.filter((alpha) => alpha === 0)).toHaveLength(100);
    for (const [index, [ox, oy]] of [
      [0, [0, 0]],
      [1, [10, 0]],
      [2, [0, 10]],
    ] as [number, [number, number]][]) {
      const picture = squares[index]!;
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
          const o = ((oy + y) * 20 + ox + x) * 4;
          expect(touching.data.slice(o, o + 4)).toEqual(
            Array.from(picture.rgba.subarray((y * 10 + x) * 4, (y * 10 + x) * 4 + 4)),
          );
        }
      }
    }

    expect(offending(requests)).toEqual([]);
  } finally {
    await context.close();
  }
});

test('sprite-sheet: files with the same name get distinct class names and the table lists every sprite', async ({
  page,
}) => {
  await openTool(page, 'sprite-sheet');
  const requests = recordRequests(page);

  // Names that give the same class name, a name with a copy marker, a hostile name and a name with no letters at all.
  const hostile = `"}; body{display:none} /*.png`;
  const names = ['icon.png', 'Icon.PNG', 'icon (copy).png', hostile, '---.png'];
  const pictures = names.map((name, i) => distinctPng(name, 4 + i, 4, i));
  await attachMany(
    page,
    'images',
    pictures.map((p) => p.file),
  );
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('table.output-table')).toBeVisible({ timeout: 30_000 });

  // Every sprite is listed, in the order picked, with distinct classes made only of a to z, 0 to 9 and hyphens.
  const rows = await spriteRows(page);
  expect(rows.map((r) => r[0])).toEqual([
    'sprite-icon',
    'sprite-icon-2',
    'sprite-icon-copy',
    'sprite-body-display-none',
    'sprite-sprite',
  ]);
  expect(new Set(rows.map((r) => r[0])).size).toBe(5);
  for (const row of rows) expect(row[0]).toMatch(/^sprite-[a-z0-9-]{1,40}$/);
  // Widths are the pictures' own (4, 5, 6, 7, 8), heights 4, and no two rows share a position.
  expect(rows.map((r) => [r[3], r[4]])).toEqual([
    ['4', '4'],
    ['5', '4'],
    ['6', '4'],
    ['7', '4'],
    ['8', '4'],
  ]);
  expect(new Set(rows.map((r) => `${r[1]},${r[2]}`)).size).toBe(5);

  // The CSS and the markup carry the same classes, and no picked file name appears anywhere in the output.
  const css = await codeText(page);
  for (const cls of ['sprite-icon', 'sprite-icon-2', 'sprite-icon-copy', 'sprite-body-display-none', 'sprite-sprite']) {
    expect(css).toContain(`.${cls} {`);
  }
  expect(css.split('\n').filter((l) => l.startsWith('.sprite-')).length).toBe(5);
  const shown = await outputArea(page).innerText();
  expect(shown).not.toContain('Icon.PNG');
  expect(shown).not.toContain('display:none}');
  expect(shown).not.toContain('/*');
  expect(shown).toContain('<span class="sprite sprite-icon-2"></span>');

  // A picked file that is not a picture is refused with a plain sentence that names its place, never its name.
  await attachMany(page, 'images', [
    pictures[0]!.file,
    { name: 'FODT-NOT-A-PICTURE.png', mimeType: 'image/png', buffer: Buffer.from('this is plain text, not a picture') },
  ]);
  await runButtonOf(page).click();
  const issues = outputArea(page).locator('.issue-list');
  await expect(issues).toContainText('Image 2: This is not a PNG, JPEG, GIF, WebP or BMP image.', { timeout: 15_000 });
  await expect(issues).not.toContainText('FODT-NOT-A-PICTURE');
  expect(await outputArea(page).locator('table.output-table').count()).toBe(0);

  // Padding outside 0 to 64 is refused naming the field and its range.
  await attachMany(page, 'images', [pictures[0]!.file]);
  await fillField(page, 'padding', '65');
  await runButtonOf(page).click();
  await expect(issues).toContainText('Padding must be a whole number from 0 to 64.', { timeout: 15_000 });

  expect(offending(requests)).toEqual([]);
});

/**
 * Image Splitter (plan 15-06). A picture is made here with a different opaque colour in every pixel, split in both modes,
 * and the downloaded ZIP is read by a small stored-ZIP reader written in this spec from PKWARE's APPNOTE (its checksums
 * come from Node's own CRC-32, not from the page). Every PNG tile is decoded in the page and compared pixel for pixel with
 * the matching part of the drawn picture, so edge tiles are checked as much as the others. The rectangles are worked out
 * here from the stated rules, never taken from the page's own table. JPEG tiles are lossy: only their kind, name and size
 * are checked.
 */
interface ReadZipEntry {
  name: string;
  method: number;
  crc: number;
  data: Buffer;
}

/** Reads a ZIP with no comment and no ZIP64 record, the way APPNOTE.TXT lays it out. */
function readStoredZip(zip: Buffer): ReadZipEntry[] {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  expect(zip.readUInt16LE(end + 20)).toBe(0);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries: ReadZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const packed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    expect(zip.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    expect(packed).toBe(size);
    entries.push({ name, method, crc, data: zip.subarray(start, start + packed) });
  }
  return entries;
}

/** Starts and sizes of `parts` pieces of `size`, each piece starting at the whole number below its share (the rule the page states). */
function evenSpans(size: number, parts: number): [number, number][] {
  const edges = Array.from({ length: parts + 1 }, (_, i) => Math.floor((i * size) / parts));
  return edges.slice(0, parts).map((start, i) => [start, edges[i + 1]! - start]);
}

/** Starts and sizes of pieces of a fixed `step`, the last one what is left. */
function stepSpans(size: number, step: number): [number, number][] {
  const spans: [number, number][] = [];
  for (let start = 0; start < size; start += step) spans.push([start, Math.min(step, size - start)]);
  return spans;
}

interface ExpectedTile {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Row-major rectangles from column and row spans, named tile-r<row>-c<column> with the given extension. */
function expectedTiles(columns: [number, number][], rows: [number, number][], extension: string): ExpectedTile[] {
  const pad = String(Math.max(rows.length, columns.length)).length;
  const tiles: ExpectedTile[] = [];
  rows.forEach(([y, height], r) =>
    columns.forEach(([x, width], c) => {
      const name = `tile-r${String(r + 1).padStart(pad, '0')}-c${String(c + 1).padStart(pad, '0')}.${extension}`;
      tiles.push({ name, x, y, width, height });
    }),
  );
  return tiles;
}

/** Proves one run: the table, the ZIP's structure and checksums, and (for PNG) every tile's pixels. */
async function proveTiles(
  page: Page,
  picture: DistinctPicture,
  tiles: ExpectedTile[],
  kind: 'png' | 'jpeg',
): Promise<void> {
  expect(await spriteRows(page)).toEqual(
    tiles.map((t) => [t.name, String(t.x), String(t.y), String(t.width), String(t.height)]),
  );
  const zip = await downloadNamed(page, 'tiles.zip');
  const entries = readStoredZip(zip);
  expect(entries.map((e) => e.name)).toEqual(tiles.map((t) => t.name));
  let covered = 0;
  for (let i = 0; i < tiles.length; i++) {
    const entry = entries[i]!;
    const tile = tiles[i]!;
    expect(entry.method).toBe(0);
    expect(entry.crc).toBe(crc32(entry.data));
    const decoded = await decodeRgba(page, entry.data.toString('base64'), kind === 'jpeg' ? 'image/jpeg' : 'image/png');
    expect([decoded.width, decoded.height]).toEqual([tile.width, tile.height]);
    if (kind === 'jpeg') {
      expect([...entry.data.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
      continue;
    }
    expect([...entry.data.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    for (let y = 0; y < tile.height; y++) {
      for (let x = 0; x < tile.width; x++) {
        const from = ((tile.y + y) * picture.width + tile.x + x) * 4;
        const to = (y * tile.width + x) * 4;
        expect(decoded.data.slice(to, to + 4)).toEqual(Array.from(picture.rgba.subarray(from, from + 4)));
      }
    }
    covered += tile.width * tile.height;
  }
  if (kind === 'png') expect(covered).toBe(picture.width * picture.height);
}

test('image-splitter: every tile in the ZIP decodes to exactly the matching part of the image, edge tiles included', async ({
  page,
}) => {
  await openTool(page, 'image-splitter');
  const requests = recordRequests(page);

  // A 37 by 23 picture, every pixel a different opaque colour.
  const picture = distinctPng('wide.png', 37, 23, 6);
  await attachImage(page, 'file', picture.file);

  // Rows and columns: 3 rows and 4 columns. Columns start at 0, 9, 18 and 27 (37 / 4 = 9.25 and so on) and are 9, 9, 9 and 10
  // wide; rows start at 0, 7 and 15 (23 / 3 = 7.67 and so on) and are 7, 8 and 8 tall.
  await fillField(page, 'rows', '3');
  await fillField(page, 'columns', '4');
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('table.output-table')).toBeVisible({ timeout: 30_000 });
  await expect(outputArea(page).locator('dl.kv')).toContainText('12 (3 rows by 4 columns)');
  await expect(outputArea(page).locator('dl.kv')).toContainText('37 by 23 pixels');
  const gridTiles = expectedTiles(evenSpans(37, 4), evenSpans(23, 3), 'png');
  expect(gridTiles.map((t) => [t.x, t.width])).toEqual([
    [0, 9],
    [9, 9],
    [18, 9],
    [27, 10],
    [0, 9],
    [9, 9],
    [18, 9],
    [27, 10],
    [0, 9],
    [9, 9],
    [18, 9],
    [27, 10],
  ]);
  await proveTiles(page, picture, gridTiles, 'png');

  // Tile size: 10 by 10. Columns start at 0, 10, 20 and 30, the last one 7 wide; rows start at 0, 10 and 20, the last 3 tall.
  await page.locator('input[name="mode"][value="size"]').click();
  await fillField(page, 'tileWidth', '10');
  await fillField(page, 'tileHeight', '10');
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('dl.kv')).toContainText(
    'Smaller: the last column is 7 pixels wide and the last row is 3 pixels tall',
    {
      timeout: 30_000,
    },
  );
  const sizeTiles = expectedTiles(stepSpans(37, 10), stepSpans(23, 10), 'png');
  expect(sizeTiles).toHaveLength(12);
  expect(sizeTiles[3]).toEqual({ name: 'tile-r1-c4.png', x: 30, y: 0, width: 7, height: 10 });
  expect(sizeTiles[11]).toEqual({ name: 'tile-r3-c4.png', x: 30, y: 20, width: 7, height: 3 });
  await proveTiles(page, picture, sizeTiles, 'png');

  // JPEG tiles: the same rectangles, named .jpg, each a JPEG of the right size (JPEG is lossy, so no pixels are compared).
  await page.locator('input[name="format"][value="jpeg"]').click();
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('table.output-table')).toContainText('tile-r1-c1.jpg', { timeout: 30_000 });
  await expect(outputArea(page)).toContainText('JPEG tiles lose some detail');
  await proveTiles(page, picture, expectedTiles(stepSpans(37, 10), stepSpans(23, 10), 'jpg'), 'jpeg');

  // A tile size that would make too many tiles is refused with the count, and no ZIP is offered.
  await page.locator('input[name="format"][value="png"]').click();
  await fillField(page, 'tileWidth', '1');
  await fillField(page, 'tileHeight', '1');
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('.issue-list')).toContainText(
    'That would make 851 tiles. The most is 400 tiles',
    {
      timeout: 15_000,
    },
  );
  expect(await outputArea(page).locator('li', { hasText: 'tiles.zip' }).count()).toBe(0);

  expect(offending(requests)).toEqual([]);
});

declare global {
  interface Window {
    __FODT_TOBLOB_DELAY_MS__?: number;
    __FODT_TOBLOB_CALLS__?: number;
  }
}

test('image-splitter: Cancel during splitting offers no ZIP and the next run works', async ({ page }) => {
  // Every encode the page asks a canvas for is delayed by 40 ms (and counted), so 100 tiles take seconds on every engine
  // and Cancel can be pressed part way through.
  await page.addInitScript(() => {
    window.__FODT_TOBLOB_DELAY_MS__ = 40;
    window.__FODT_TOBLOB_CALLS__ = 0;
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (this: HTMLCanvasElement, callback, type, quality) {
      window.__FODT_TOBLOB_CALLS__ = (window.__FODT_TOBLOB_CALLS__ ?? 0) + 1;
      const wait = window.__FODT_TOBLOB_DELAY_MS__ ?? 0;
      if (wait > 0) setTimeout(() => original.call(this, callback, type, quality), wait);
      else original.call(this, callback, type, quality);
    };
  });
  await openTool(page, 'image-splitter');
  const requests = recordRequests(page);
  const picture = distinctPng('square.png', 100, 100, 7);
  await attachImage(page, 'file', picture.file);
  await fillField(page, 'rows', '10');
  await fillField(page, 'columns', '10');
  const calls = () => page.evaluate(() => window.__FODT_TOBLOB_CALLS__ ?? 0);
  const tileNumber = () =>
    page.evaluate(() => {
      const match = /Tile (\d+) of 100/.exec(document.body.innerText);
      return match ? Number(match[1]) : 0;
    });

  await runButtonOf(page).click();
  await expect(cancelButtonOf(page)).toBeVisible();
  await expect.poll(tileNumber, { timeout: 30_000 }).toBeGreaterThanOrEqual(5);
  await expect(page.locator('progress.tool-progress')).toBeVisible();
  expect(await outputArea(page).locator('li', { hasText: 'tiles.zip' }).count()).toBe(0);

  // Cancel: the run ends with the plain note, no ZIP is offered and the bar is gone.
  await cancelButtonOf(page).click();
  const note = outputArea(page).locator('.note-warn');
  await expect(note).toHaveText('Cancelled before finishing. No result was produced.', { timeout: 3_000 });
  expect(await outputArea(page).locator('li', { hasText: 'tiles.zip' }).count()).toBe(0);
  expect(await outputArea(page).locator('table.output-table').count()).toBe(0);
  await expect(page.locator('progress.tool-progress')).toHaveCount(0);

  // It stopped at once: at most the tile being encoded when Cancel was pressed is finished afterwards, and nothing arrives.
  const atCancel = await calls();
  expect(atCancel).toBeLessThan(100);
  await page.waitForTimeout(800);
  expect((await calls()) - atCancel).toBeLessThanOrEqual(1);
  expect(await outputArea(page).locator('li', { hasText: 'tiles.zip' }).count()).toBe(0);
  await expect(note).toHaveText('Cancelled before finishing. No result was produced.');

  // The next run starts from the beginning and finishes with every tile and a ZIP that holds all 100.
  await page.evaluate(() => {
    window.__FODT_TOBLOB_DELAY_MS__ = 0;
  });
  const before = await calls();
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('li', { hasText: 'tiles.zip' })).toBeVisible({ timeout: 30_000 });
  expect((await calls()) - before).toBeGreaterThanOrEqual(100);
  const rows = await spriteRows(page);
  expect(rows).toHaveLength(100);
  expect(rows[0]![0]).toBe('tile-r01-c01.png');
  expect(rows[99]![0]).toBe('tile-r10-c10.png');
  const entries = readStoredZip(await downloadNamed(page, 'tiles.zip'));
  expect(entries).toHaveLength(100);
  expect(entries[99]!.name).toBe('tile-r10-c10.png');
  expect(offending(requests)).toEqual([]);
});

/**
 * Image Converter & Resizer upgrade (plan 15-07): crop, rotate and flip, and SVG input when it is allowed.
 *
 * Pixels are checked by reading the downloaded file with a small PNG reader written here (8-bit RGB and RGBA, every
 * filter type, no interlace), so what is compared is the file's own pixel values and never what a browser makes of the
 * file when it shows it again (some engines write colour tags into a canvas PNG and colour-manage the file on the way
 * back in, moving values by one). The expected pixels come from a model written here: crop, then a clockwise quarter
 * turn, then a mirror, over pixels that are each a different colour.
 */
function decodePngBytes(png: Buffer): { width: number; height: number; rgba: Uint8Array } {
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  let position = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = 0;
  let interlace = 0;
  const data: Buffer[] = [];
  while (position < png.length) {
    const length = png.readUInt32BE(position);
    const type = png.toString('latin1', position + 4, position + 8);
    const body = png.subarray(position + 8, position + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8]!;
      colour = body[9]!;
      interlace = body[12]!;
    } else if (type === 'IDAT') {
      data.push(body);
    }
    position += 12 + length;
  }
  expect([depth, interlace]).toEqual([8, 0]);
  expect([2, 6]).toContain(colour);
  const bytesPerPixel = colour === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(data));
  expect(raw.length).toBe(height * (stride + 1));
  const flat = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x]!;
      const left = x >= bytesPerPixel ? flat[y * stride + x - bytesPerPixel]! : 0;
      const up = y > 0 ? flat[(y - 1) * stride + x]! : 0;
      const upLeft = x >= bytesPerPixel && y > 0 ? flat[(y - 1) * stride + x - bytesPerPixel]! : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(up - upLeft);
        const pb = Math.abs(left - upLeft);
        const pc = Math.abs(left + up - 2 * upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else {
        expect([0, 1, 2, 3, 4]).toContain(filter);
      }
      flat[y * stride + x] = (value + predicted) & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = flat[i * bytesPerPixel]!;
    rgba[i * 4 + 1] = flat[i * bytesPerPixel + 1]!;
    rgba[i * 4 + 2] = flat[i * bytesPerPixel + 2]!;
    rgba[i * 4 + 3] = bytesPerPixel === 4 ? flat[i * bytesPerPixel + 3]! : 255;
  }
  return { width, height, rgba };
}

/** Chooses an option of a select field and checks the choice stuck (repeated until it holds). */
async function chooseOption(page: Page, name: string, value: string): Promise<void> {
  const field = page.locator(`#f-${name}`);
  await expect(async () => {
    await field.selectOption(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

interface EditCase {
  label: string;
  crop?: { x: number; y: number; width: number; height: number };
  rotate: 0 | 90 | 180 | 270;
  flip: 'none' | 'horizontal' | 'vertical' | 'both';
}

/** The picture after the edits, as a grid of the source coordinates of each pixel: crop, quarter turns clockwise, mirror. */
function modelEdits(width: number, height: number, edit: EditCase): [number, number][][] {
  const c = edit.crop ?? { x: 0, y: 0, width, height };
  let grid: [number, number][][] = [];
  for (let y = 0; y < c.height; y++) {
    const row: [number, number][] = [];
    for (let x = 0; x < c.width; x++) row.push([c.x + x, c.y + y]);
    grid.push(row);
  }
  for (let turn = 0; turn < edit.rotate / 90; turn++) {
    const h = grid.length;
    const w = grid[0]!.length;
    const turned: [number, number][][] = [];
    for (let y = 0; y < w; y++) {
      const row: [number, number][] = [];
      for (let x = 0; x < h; x++) row.push(grid[h - 1 - x]![y]!);
      turned.push(row);
    }
    grid = turned;
  }
  if (edit.flip === 'horizontal' || edit.flip === 'both') grid = grid.map((row) => row.slice().reverse());
  if (edit.flip === 'vertical' || edit.flip === 'both') grid = grid.slice().reverse();
  return grid;
}

async function setEdit(page: Page, edit: EditCase): Promise<void> {
  await chooseOption(page, 'transform', 'edit');
  if (edit.crop) {
    await fillField(page, 'cropX', String(edit.crop.x));
    await fillField(page, 'cropY', String(edit.crop.y));
    await fillField(page, 'cropW', String(edit.crop.width));
    await fillField(page, 'cropH', String(edit.crop.height));
  }
  await chooseOption(page, 'rotate', String(edit.rotate));
  await chooseOption(page, 'flip', edit.flip);
}

async function resetPage(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('#f-transform')).toHaveValue('none');
}

test('image-converter: crop, rotate and flip give exactly the model pixels in this browser', async ({ page }) => {
  test.setTimeout(120_000);
  await openTool(page, 'image-converter');
  const requests = recordRequests(page);

  // 7 by 5, every pixel a different opaque colour.
  const picture = distinctPng('edit.png', 7, 5, 8);
  const cases: EditCase[] = [
    { label: 'crop only', crop: { x: 1, y: 1, width: 4, height: 3 }, rotate: 0, flip: 'none' },
    { label: 'rotate 90', rotate: 90, flip: 'none' },
    { label: 'rotate 180', rotate: 180, flip: 'none' },
    { label: 'rotate 270', rotate: 270, flip: 'none' },
    { label: 'flip horizontal', rotate: 0, flip: 'horizontal' },
    { label: 'flip vertical', rotate: 0, flip: 'vertical' },
    { label: 'flip both', rotate: 0, flip: 'both' },
    {
      label: 'crop, rotate 90 and flip horizontal',
      crop: { x: 2, y: 0, width: 5, height: 5 },
      rotate: 90,
      flip: 'horizontal',
    },
  ];
  for (const edit of cases) {
    await resetPage(page);
    await attachImage(page, 'file', picture.file);
    await setEdit(page, edit);
    await runButtonOf(page).click();
    await expect(outputArea(page).locator('li', { hasText: 'edit.png' })).toBeVisible({ timeout: 30_000 });

    const expected = modelEdits(7, 5, edit);
    const decoded = decodePngBytes(await downloadNamed(page, 'edit.png'));
    expect([decoded.width, decoded.height], edit.label).toEqual([expected[0]!.length, expected.length]);
    await expect(outputArea(page), edit.label).toContainText(`${decoded.width} × ${decoded.height}`);
    let wrong = 0;
    for (let y = 0; y < decoded.height; y++) {
      for (let x = 0; x < decoded.width; x++) {
        const [sx, sy] = expected[y]![x]!;
        const want = picture.rgba.subarray((sy * 7 + sx) * 4, (sy * 7 + sx) * 4 + 4);
        const got = decoded.rgba.subarray((y * decoded.width + x) * 4, (y * decoded.width + x) * 4 + 4);
        if (want.join(',') !== got.join(',')) wrong++;
      }
    }
    expect(wrong, `${edit.label}: pixels that differ from the model`).toBe(0);
  }

  // A crop outside the picture is refused with the picture's size, and nothing is offered.
  await resetPage(page);
  await attachImage(page, 'file', picture.file);
  await setEdit(page, { label: 'outside', crop: { x: 5, y: 0, width: 4, height: 2 }, rotate: 0, flip: 'none' });
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('.issue-list')).toContainText(
    'does not fit inside the picture, which is 7 by 5 pixels',
    {
      timeout: 15_000,
    },
  );
  expect(await outputArea(page).getByRole('button', { name: 'Download' }).count()).toBe(0);

  // A width without a height is refused by name, never completed with a guess.
  await fillField(page, 'cropW', '3');
  await fillField(page, 'cropH', '0');
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('.issue-list')).toContainText('Crop width and Crop height must both be set', {
    timeout: 15_000,
  });

  // A resize measures the edited picture: crop 4 by 3, rotate 90 (3 by 4), then 200 percent gives 6 by 8.
  await resetPage(page);
  await attachImage(page, 'file', picture.file);
  await setEdit(page, { label: 'resize', crop: { x: 1, y: 1, width: 4, height: 3 }, rotate: 90, flip: 'none' });
  await page.locator('input[name="resize"][value="percent"]').click();
  await fillField(page, 'percent', '200');
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('li', { hasText: 'edit.png' })).toBeVisible({ timeout: 30_000 });
  const resized = decodePngBytes(await downloadNamed(page, 'edit.png'));
  expect([resized.width, resized.height]).toEqual([6, 8]);

  expect(offending(requests)).toEqual([]);
});

/** Four flat rectangles, 20 by 10 each, in a 40 by 20 picture: red and green on top, blue and yellow below. */
const FLAT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20">' +
  '<rect x="0" y="0" width="20" height="10" fill="#ff0000"/><rect x="20" y="0" width="20" height="10" fill="#00ff00"/>' +
  '<rect x="0" y="10" width="20" height="10" fill="#0000ff"/><rect x="20" y="10" width="20" height="10" fill="#ffff00"/></svg>';

function svgFile(name: string, text: string): PickedFile {
  return { name, mimeType: 'image/svg+xml', buffer: Buffer.from(text, 'utf8') };
}

function pixelOf(image: { width: number; rgba: Uint8Array }, x: number, y: number): string {
  return Array.from(image.rgba.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)).join(',');
}

test('image-converter: an SVG of flat rectangles converts with exact colours only when Allow SVG input is ticked', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openTool(page, 'image-converter');
  const requests = recordRequests(page);

  // Unticked, the file is refused exactly as before: the ordinary message and nothing offered.
  await attachImage(page, 'file', svgFile('flat.svg', FLAT_SVG));
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('.issue-list')).toContainText("Could not convert 'flat.svg'", {
    timeout: 15_000,
  });
  await expect(outputArea(page).locator('.issue-list')).toContainText('not PNG, JPEG, GIF, WebP or BMP');
  expect(await outputArea(page).getByRole('button', { name: 'Download' }).count()).toBe(0);

  // Ticked, it is drawn by the browser at its own size and the file's pixels are exactly the four colours.
  await page.locator('#f-allowSvg').check();
  await expect(page.locator('#f-allowSvg')).toBeChecked();
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('li', { hasText: 'flat.png' })).toBeVisible({ timeout: 30_000 });
  const plain = decodePngBytes(await downloadNamed(page, 'flat.png'));
  expect([plain.width, plain.height]).toEqual([40, 20]);
  expect([pixelOf(plain, 10, 5), pixelOf(plain, 30, 5), pixelOf(plain, 10, 15), pixelOf(plain, 30, 15)]).toEqual([
    '255,0,0,255',
    '0,255,0,255',
    '0,0,255,255',
    '255,255,0,255',
  ]);
  // Every pixel is one of the four colours: the drawing did not blend the edges of the rectangles.
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 40; x++) {
      const expected = ['255,0,0,255', '0,255,0,255', '0,0,255,255', '255,255,0,255'][
        (y < 10 ? 0 : 2) + (x < 20 ? 0 : 1)
      ];
      expect(pixelOf(plain, x, y)).toBe(expected);
    }
  }
  await expect(outputArea(page)).toContainText('SVG, ');
  await expect(outputArea(page)).toContainText('40 × 20');

  // An SVG takes the edits too: rotated a quarter turn clockwise, the picture is 20 by 40 with blue top left, red top
  // right, yellow bottom left and green bottom right.
  await chooseOption(page, 'transform', 'edit');
  await chooseOption(page, 'rotate', '90');
  await runButtonOf(page).click();
  await expect(outputArea(page)).toContainText('20 × 40', { timeout: 30_000 });
  const turned = decodePngBytes(await downloadNamed(page, 'flat.png'));
  expect([turned.width, turned.height]).toEqual([20, 40]);
  expect([pixelOf(turned, 5, 10), pixelOf(turned, 15, 10), pixelOf(turned, 5, 30), pixelOf(turned, 15, 30)]).toEqual([
    '0,0,255,255',
    '255,0,0,255',
    '255,255,0,255',
    '0,255,0,255',
  ]);

  // A file that only looks like an SVG at the start, and one that is not text, take the converter's own refusal.
  await chooseOption(page, 'transform', 'none');
  await attachImage(page, 'file', {
    name: 'broken.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.concat([
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('</svg>'),
    ]),
  });
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('.issue-list')).toContainText("Could not convert 'broken.svg'", {
    timeout: 15_000,
  });
  await expect(outputArea(page).locator('.issue-list')).toContainText('not PNG, JPEG, GIF, WebP or BMP');

  expect(offending(requests)).toEqual([]);
});

/**
 * Starts a local server on a free port that records every request it receives, runs `body` with its address, waits a
 * moment for any stray request to land, and returns what the server saw. An SVG that names this server (an image, a style
 * sheet, a font, a frame, a link) would show up here if the page or the browser requested it. Written here, the shape
 * copied from e2e/security-secrets.spec.ts.
 */
async function withRecordingServer(body: (address: string) => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  const server = createServer((request, response) => {
    seen.push(`${request.method} ${request.url}`);
    response.end('x');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await body(`http://127.0.0.1:${port}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return seen;
}

const SVG_NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';

interface HostileSvg {
  name: string;
  svg: (address: string) => string;
  /** What the refusal must call it. */
  construct: string;
  /** The text whose first occurrence starts the refused construct: its character position is the message's number. */
  at: string;
}

const flatSvg = (inner: string, head = ''): string =>
  `${head}<svg ${SVG_NS} width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" fill="#00ff00"/>${inner}</svg>`;

/** Each of these asks for something outside the SVG; every one must be refused by name and none may reach the server. */
const HOSTILE_SVGS: HostileSvg[] = [
  {
    name: 'image href',
    svg: (a) => flatSvg(`<image href="${a}/ok.svg" width="20" height="20"/>`),
    construct: 'a link to something outside this SVG',
    at: 'href',
  },
  {
    name: 'image xlink:href',
    svg: (a) => flatSvg(`<image xlink:href="${a}/ok.svg?x=1" width="20" height="20"/>`),
    construct: 'a link to something outside this SVG',
    at: 'xlink:href',
  },
  {
    name: 'use of another file',
    svg: (a) => flatSvg(`<use href="${a}/ok.svg#a"/>`),
    construct: 'a link to something outside this SVG',
    at: 'href',
  },
  {
    name: 'style import',
    svg: (a) => flatSvg(`<style>@import url(${a}/ok.css);</style>`),
    construct: 'a style element that loads another file',
    at: '<style',
  },
  {
    name: 'style background address',
    svg: (a) => flatSvg(`<style>rect{fill:url(${a}/ok.svg#x)}</style>`),
    construct: 'a style element that loads another file',
    at: '<style',
  },
  {
    name: 'style font address',
    svg: (a) =>
      flatSvg(
        `<style>@font-face{font-family:x;src:url(${a}/font.woff)} text{font-family:x}</style><text x="5" y="20">hi</text>`,
      ),
    construct: 'a style element that loads another file',
    at: '<style',
  },
  {
    name: 'feImage',
    svg: (a) =>
      flatSvg(
        `<filter id="f"><feImage href="${a}/ok.svg?fe=1"/></filter><rect width="40" height="40" filter="url(#f)"/>`,
      ),
    construct: 'a link to something outside this SVG',
    at: 'href',
  },
  {
    name: 'foreignObject holding an image',
    svg: (a) =>
      flatSvg(
        `<foreignObject width="40" height="40"><div xmlns="http://www.w3.org/1999/xhtml"><img src="${a}/ok.svg?fo=1"/></div></foreignObject>`,
      ),
    construct: 'a foreignObject element',
    at: '<foreignObject',
  },
  {
    name: 'script',
    svg: (a) => flatSvg(`<script>new Image().src='${a}/script-ran'</script>`),
    construct: 'a script element',
    at: '<script',
  },
  {
    name: 'onload',
    svg: (a) =>
      `<svg ${SVG_NS} width="40" height="40" onload="new Image().src='${a}/onload-ran'"><rect width="40" height="40"/></svg>`,
    construct: 'an event handler attribute',
    at: 'onload',
  },
  {
    name: 'xml-stylesheet',
    svg: (a) => flatSvg('', `<?xml version="1.0"?><?xml-stylesheet type="text/css" href="${a}/ok.css"?>`),
    construct: 'an xml-stylesheet instruction',
    at: '<?xml-stylesheet',
  },
  {
    name: 'DOCTYPE with a definition address',
    svg: (a) => flatSvg('', `<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "${a}/dtd.dtd">`),
    construct: 'a DOCTYPE declaration',
    at: '<!DOCTYPE',
  },
  {
    name: 'DOCTYPE with an external entity',
    svg: (a) => flatSvg('&x;', `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "${a}/entity.txt">]>`),
    construct: 'a DOCTYPE declaration',
    at: '<!DOCTYPE',
  },
  {
    name: 'anchor',
    svg: (a) => flatSvg(`<a href="${a}/click"><rect width="40" height="40"/></a>`),
    construct: 'a link to something outside this SVG',
    at: 'href',
  },
  {
    name: 'mask with an address',
    svg: (a) =>
      flatSvg(
        `<mask id="m"><rect width="40" height="40"/></mask><rect width="40" height="40" mask="url(${a}/ok.svg#m)"/>`,
      ),
    construct: 'a value that loads another file',
    at: 'mask="url(http',
  },
  {
    name: 'iframe',
    svg: (a) => flatSvg(`<iframe src="${a}/frame"/>`),
    construct: 'an iframe element',
    at: '<iframe',
  },
  {
    name: 'object',
    svg: (a) => flatSvg(`<object data="${a}/object"/>`),
    construct: 'an object element',
    at: '<object',
  },
  {
    name: 'link element',
    svg: (a) => flatSvg(`<link rel="stylesheet" href="${a}/ok.css"/>`),
    construct: 'a link element',
    at: '<link',
  },
  {
    name: 'style attribute address',
    svg: (a) => flatSvg(`<rect width="40" height="40" style="fill:url(${a}/ok.svg#p)"/>`),
    construct: 'a value that loads another file',
    at: 'style="fill',
  },
  {
    name: 'embedded data picture',
    svg: () => flatSvg(`<image href="data:image/png;base64,iVBORw0KGgo=" width="20" height="20"/>`),
    construct: 'a link to something outside this SVG',
    at: 'href',
  },
];

test('image-converter: hostile SVGs are refused and a local server receives nothing', async ({ page }) => {
  test.setTimeout(180_000);
  expect(HOSTILE_SVGS.length).toBeGreaterThanOrEqual(18);
  const seen = await withRecordingServer(async (address) => {
    await openTool(page, 'image-converter');
    const requests = recordRequests(page);
    await page.locator('#f-allowSvg').check();
    await expect(page.locator('#f-allowSvg')).toBeChecked();
    for (const hostile of HOSTILE_SVGS) {
      const text = hostile.svg(address);
      const position = text.indexOf(hostile.at) + 1;
      expect(position, `${hostile.name}: test data`).toBeGreaterThan(0);
      await attachImage(page, 'file', svgFile('hostile.svg', text));
      await runButtonOf(page).click();
      const issues = outputArea(page).locator('.issue-list');
      await expect(issues, hostile.name).toContainText(
        `This SVG uses ${hostile.construct} at character ${position}, which this page does not load. Remove it and try again.`,
        { timeout: 30_000 },
      );
      // The refusal never repeats the file's own text, the address it names or the script it holds.
      const message = await issues.innerText();
      expect(message, hostile.name).not.toContain(address);
      expect(message, hostile.name).not.toContain('ok.css');
      expect(message, hostile.name).not.toContain('script-ran');
      expect(await outputArea(page).getByRole('button', { name: 'Download' }).count(), hostile.name).toBe(0);
    }
    // Nothing went anywhere else either: the page's own recorder saw only data and blob addresses.
    expect(offending(requests)).toEqual([]);
  });
  expect(seen).toEqual([]);
});

test('image-converter: the recording server sees a plain page request, so its silence means something', async ({
  page,
}) => {
  const control = await withRecordingServer(async (address) => {
    await openTool(page, 'image-converter');
    // The same server, asked by the page itself: it must be heard.
    await page.evaluate((target) => fetch(target, { mode: 'no-cors' }).then(() => undefined), `${address}/control`);
  });
  expect(control).toEqual(['GET /control']);
  // And a picture the page's own document asks for is heard too, which is what an SVG with an image in it would be if it
  // were drawn without the check.
  const image = await withRecordingServer(async (address) => {
    await openTool(page, 'image-converter');
    await page.evaluate(
      (target) =>
        new Promise<void>((resolve) => {
          const probe = new Image();
          probe.onload = () => resolve();
          probe.onerror = () => resolve();
          probe.src = target;
        }),
      `${address}/control-image.svg`,
    );
  });
  expect(new Set(image)).toEqual(new Set(['GET /control-image.svg']));
});

test('image-converter: an SVG with a filter and a few uses converts, and reuse that holds reuse or over 1000 uses is refused', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openTool(page, 'image-converter');
  const requests = recordRequests(page);
  await page.locator('#f-allowSvg').check();
  await expect(page.locator('#f-allowSvg')).toBeChecked();

  // A filter that moves nothing and two uses of one green square: both halves come out green.
  const normal =
    `<svg ${SVG_NS} width="40" height="20" viewBox="0 0 40 20"><defs><filter id="f"><feOffset dx="0" dy="0"/></filter>` +
    '<rect id="r" width="20" height="20" fill="#00ff00"/></defs><use href="#r"/><use href="#r" x="20" filter="url(#f)"/></svg>';
  await attachImage(page, 'file', svgFile('normal.svg', normal));
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('li', { hasText: 'normal.png' })).toBeVisible({ timeout: 30_000 });
  const converted = decodePngBytes(await downloadNamed(page, 'normal.png'));
  expect([converted.width, converted.height]).toEqual([40, 20]);
  expect([pixelOf(converted, 10, 10), pixelOf(converted, 30, 10)]).toEqual(['0,255,0,255', '0,255,0,255']);

  // A use of an element that holds another use is refused at the using element, by name and position.
  const chained = flatSvg('<g id="a"><use href="#b"/></g><use href="#a"/>');
  await attachImage(page, 'file', svgFile('chained.svg', chained));
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('.issue-list')).toContainText(
    `This SVG has a use element at character ${chained.lastIndexOf('<use href="#a"/>') + 1} that reuses an element holding another use element, which this page does not draw.`,
    { timeout: 30_000 },
  );
  expect(await outputArea(page).getByRole('button', { name: 'Download' }).count()).toBe(0);

  // 1001 use elements are refused at the 1001st; 1000 are drawn.
  const uses = (n: number): string => '<defs><rect id="q" width="1" height="1"/></defs>' + '<use href="#q"/>'.repeat(n);
  const crowded = flatSvg(uses(1001));
  await attachImage(page, 'file', svgFile('crowded.svg', crowded));
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('.issue-list')).toContainText(
    `This SVG has more than 1,000 use elements (the 1,001st is at character ${crowded.lastIndexOf('<use href="#q"/>') + 1})`,
    { timeout: 30_000 },
  );
  await attachImage(page, 'file', svgFile('thousand.svg', flatSvg(uses(1000))));
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('li', { hasText: 'thousand.png' })).toBeVisible({ timeout: 30_000 });

  expect(offending(requests)).toEqual([]);
});

test('image-converter: an SVG sized in em and ex is drawn at 16 and 8 pixels to the unit, not stretched', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openTool(page, 'image-converter');
  const requests = recordRequests(page);
  await page.locator('#f-allowSvg').check();
  await expect(page.locator('#f-allowSvg')).toBeChecked();

  // 10em by 5em is 160 by 80; left half red, right half blue, so a stretched drawing would move the edge.
  const halves = (width: string, height: string): string =>
    `<svg ${SVG_NS} width="${width}" height="${height}" viewBox="0 0 2 1" preserveAspectRatio="none">` +
    '<rect x="0" width="1" height="1" fill="#ff0000"/><rect x="1" width="1" height="1" fill="#0000ff"/></svg>';
  for (const [name, width, height, expected] of [
    ['em.svg', '10em', '5em', [160, 80]],
    ['ex.svg', '20ex', '10ex', [160, 80]],
  ] as const) {
    await attachImage(page, 'file', svgFile(name, halves(width, height)));
    await runButtonOf(page).click();
    const png = name.replace('.svg', '.png');
    await expect(outputArea(page).locator('li', { hasText: png })).toBeVisible({ timeout: 30_000 });
    await expect(outputArea(page)).toContainText(`${expected[0]} × ${expected[1]}`);
    const decoded = decodePngBytes(await downloadNamed(page, png));
    expect([decoded.width, decoded.height], name).toEqual([...expected]);
    expect(
      [pixelOf(decoded, 2, 40), pixelOf(decoded, 79, 40), pixelOf(decoded, 80, 40), pixelOf(decoded, 157, 40)],
      name,
    ).toEqual(['255,0,0,255', '255,0,0,255', '0,0,255,255', '0,0,255,255']);
  }
  expect(offending(requests)).toEqual([]);
});

/** The sentence every file over 100 MB is told, by any page that reads a picked file by its reported size. */
const OVER_100_MB = 'This file is larger than 100 MB, the most this page accepts.';

test('image-converter: a file over 100 MB is refused from its reported size, as a picture and as an SVG, before it is read', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openTool(page, 'image-converter');
  const requests = recordRequests(page);

  // One byte over 100 MB, made as a file that is only ever extended to its size (nothing is written into it), so no
  // 100 MB buffer is built or sent. The page must refuse it from the size the browser reports.
  const scratch = mkdtempSync(join(tmpdir(), 'fodt-big-'));
  try {
    const over = 100 * 1024 * 1024 + 1;
    const made: Record<string, string> = {};
    for (const name of ['big.png', 'big.svg']) {
      made[name] = join(scratch, name);
      writeFileSync(made[name]!, '');
      truncateSync(made[name]!, over);
    }
    // The file with the picture name starts like nothing at all (zero bytes), and the page still says the size sentence,
    // not "not a picture": the size is judged first.
    for (const [name, ticked] of [
      ['big.png', false],
      ['big.svg', true],
    ] as const) {
      await resetPage(page);
      if (ticked) await page.locator('#f-allowSvg').check();
      await expect(async () => {
        await page.locator('#f-file').setInputFiles(made[name]!);
        await expect(page.locator('.field-help', { hasText: name })).toBeVisible({ timeout: 500 });
      }).toPass({ timeout: 10_000 });
      await runButtonOf(page).click();
      await expect(outputArea(page).locator('.issue-list')).toContainText(
        `Could not convert '${name}': ${OVER_100_MB}`,
        { timeout: 30_000 },
      );
      expect(await outputArea(page).getByRole('button', { name: 'Download' }).count()).toBe(0);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  // The check comes before any read: a file that reports 100 MB and one byte and throws if it is read from is refused with
  // the sentence and none of its reading methods is called.
  const outcome = await page.evaluate(async () => {
    const hooks = (
      window as unknown as {
        __FODT_IMAGE_CONVERTER_TEST_HOOKS__?: {
          convertImageInWorker: (file: File, options: unknown, ctx: unknown) => Promise<unknown>;
        };
      }
    ).__FODT_IMAGE_CONVERTER_TEST_HOOKS__;
    if (!hooks) return { message: 'the test hook is missing', reads: [] as string[] };
    const reads: string[] = [];
    const file = new File([new Uint8Array(8)], 'huge.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 100 * 1024 * 1024 + 1 });
    for (const method of ['arrayBuffer', 'slice', 'stream', 'text']) {
      Object.defineProperty(file, method, {
        value: () => {
          reads.push(method);
          throw new Error(`${method} was called`);
        },
      });
    }
    const options = {
      format: 'png',
      quality: 85,
      background: '#ffffff',
      resize: { mode: 'none' },
    };
    try {
      await hooks.convertImageInWorker(file, options, { signal: new AbortController().signal });
      return { message: 'it was converted', reads };
    } catch (err) {
      return { message: err instanceof Error ? err.message : String(err), reads };
    }
  });
  expect(outcome).toEqual({ message: OVER_100_MB, reads: [] });

  expect(offending(requests)).toEqual([]);
});

/** A PNG signature and header chunk only: enough for a page to read the declared size, never enough to decode. */
function pngHeaderOnly(width: number, height: number): PickedFile {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const type = Buffer.from('IHDR', 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(13);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, header])));
  return {
    name: 'wide.png',
    mimeType: 'image/png',
    buffer: Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), length, type, header, crc]),
  };
}

test('image-converter: crop, rotate or flip of a picture over 40,000,000 pixels is refused before decoding, however small the resize', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openTool(page, 'image-converter');
  const requests = recordRequests(page);

  // 6500 by 6500 is 42,250,000 pixels. Turned, it needs a picture of that size before the resize to a tenth.
  await attachImage(page, 'file', pngHeaderOnly(6500, 6500));
  await setEdit(page, { label: 'turn', rotate: 90, flip: 'none' });
  await page.locator('input[name="resize"][value="percent"]').click();
  await fillField(page, 'percent', '10');
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('.issue-list')).toContainText(
    "Could not convert 'wide.png': the cropped, rotated or flipped picture would be 6500 by 6500 pixels before it is resized, above this browser's own 40,000,000-pixel limit. Crop it to a smaller area first.",
    { timeout: 30_000 },
  );
  expect(await outputArea(page).getByRole('button', { name: 'Download' }).count()).toBe(0);

  // Cropped to 6000 by 6000 (36,000,000) the plan is accepted: the file then fails later only because it holds no picture.
  await fillField(page, 'cropX', '0');
  await fillField(page, 'cropY', '0');
  await fillField(page, 'cropW', '6000');
  await fillField(page, 'cropH', '6000');
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('.issue-list')).toBeVisible({ timeout: 30_000 });
  await expect(outputArea(page).locator('.issue-list')).not.toContainText('before it is resized', { timeout: 30_000 });

  expect(offending(requests)).toEqual([]);
});

// --- CSS spinner and CSS pattern (plan 15-08) ---------------------------------------------------------------------------

/** Waits for the auto run to finish: the debounce, then the Output panel's own busy signal. */
async function settlePreview(page: Page): Promise<void> {
  await page.waitForTimeout(250);
  await expect(outputArea(page)).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
}

/** The CSS text shown beside the live preview. */
async function previewCssText(page: Page): Promise<string> {
  return (await page.locator('.css-preview pre.output').first().innerText()).trim();
}

/** The play state of every animation on the preview's own tree, in tree order. */
async function previewAnimationStates(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const host = document.querySelector('.css-preview-stage');
    const root = host?.shadowRoot?.querySelector('.css-preview-tree');
    if (!root) return ['no preview was drawn'];
    const elements = [root, ...Array.from(root.querySelectorAll('*'))];
    return elements.flatMap((element) => element.getAnimations().map((animation) => animation.playState));
  });
}

const SPINNER_KINDS: [string, number][] = [
  ['ring', 1],
  ['dual-ring', 1],
  ['dots', 3],
  ['bars', 4],
  ['pulse', 1],
  ['ripple', 2],
];

test('css-spinner: under reduced motion the preview stops and the copied CSS carries the reduced-motion rule', async ({
  page,
}) => {
  await openTool(page, 'css-spinner');
  const requests = recordRequests(page);
  for (const [kind, animated] of SPINNER_KINDS) {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator(`input[type="radio"][name="type"][value="${kind}"]`).check();
    await settlePreview(page);

    // The CSS a visitor copies carries the exact rule, and it stops every animated class.
    const css = await previewCssText(page);
    expect(css, kind).toContain('@media (prefers-reduced-motion: reduce) {');
    expect(css, kind).toContain('animation: none');

    // Without the preference the spinner moves: one running animation for each animated element.
    await expect
      .poll(() => previewAnimationStates(page), { message: `${kind} should be moving` })
      .toEqual(Array.from({ length: animated }, () => 'running'));

    // With the preference the same preview has no animation at all.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), kind).toBe(true);
    await expect.poll(() => previewAnimationStates(page), { message: `${kind} should have stopped` }).toEqual([]);
  }
  expect(offending(requests)).toEqual([]);
});

const PATTERN_IDS = [
  'stripes-diagonal',
  'stripes-horizontal',
  'stripes-vertical',
  'checks',
  'dots',
  'grid',
  'zigzag',
  'cross',
];

/**
 * A browser context like the project's own, with a whole number of device pixels to the CSS pixel. The mobile project
 * has 2.625, and at a fraction of a device pixel two separate pages round some edges of a repeating pattern the other
 * way (measured: up to 10 percent of the pixels of a frame against a blank page), which says nothing about the pattern.
 * The page layout, the touch screen and the user agent are the project's own.
 */
async function wholeScaleContext(
  browser: Browser,
  baseURL: string | undefined,
  testInfo: TestInfo,
): Promise<BrowserContext> {
  const use = testInfo.project.use;
  const scale = use.deviceScaleFactor ?? 1;
  return browser.newContext({
    baseURL,
    viewport: use.viewport ?? undefined,
    userAgent: use.userAgent,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    deviceScaleFactor: Number.isInteger(scale) ? scale : Math.ceil(scale),
  });
}

/**
 * Scrolls the element to the middle of the window and moves the page by up to four pixels, so the element's corner sits on
 * a multiple of 8 CSS pixels: that is a whole device pixel at 1, 1.5, 2, 2.5, 2.625 and 3 device pixels to the CSS pixel.
 * A screenshot of an element is cut from the page at whole device pixels, so an element at a fractional place would be
 * captured a pixel away from where the browser paints it, and every edge of a repeating pattern would differ between
 * two pages for that reason alone. The blank page the copy is drawn in puts its element at 8 by 8, which is such a place.
 */
async function sitOnWholePixel(page: Page, holder: Locator, element: Locator): Promise<void> {
  await page.evaluate(() => {
    document.body.style.position = 'relative';
    document.body.style.left = '0px';
    document.body.style.top = '0px';
  });
  await holder.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const box = await element.boundingBox();
  if (!box) throw new Error('the element has no box');
  const shiftX = Math.round(box.x / 8) * 8 - box.x;
  const shiftY = Math.round(box.y / 8) * 8 - box.y;
  await page.evaluate(
    ([dx, dy]) => {
      document.body.style.left = `${dx}px`;
      document.body.style.top = `${dy}px`;
    },
    [shiftX, shiftY],
  );
  const placed = await element.boundingBox();
  if (!placed) throw new Error('the element has no box');
  expect(
    Math.abs(placed.x - Math.round(placed.x / 8) * 8),
    'the element is not on a multiple of 8 pixels',
  ).toBeLessThan(0.02);
  expect(
    Math.abs(placed.y - Math.round(placed.y / 8) * 8),
    'the element is not on a multiple of 8 pixels',
  ).toBeLessThan(0.02);
}

/** Decodes two PNGs inside the blank page and counts the pixels that differ by more than a channel threshold. */
async function comparePatternPixels(
  blank: Page,
  shown: Buffer,
  copied: Buffer,
  channelThreshold: number,
): Promise<{ fraction: number; widthDiff: number; heightDiff: number; colours: number }> {
  return blank.evaluate(
    async ({ a, b, threshold }) => {
      function loadImage(dataUrl: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('image failed to decode'));
          img.src = dataUrl;
        });
      }
      const [imgA, imgB] = await Promise.all([loadImage(a), loadImage(b)]);
      const width = Math.min(imgA.width, imgB.width);
      const height = Math.min(imgA.height, imgB.height);
      const read = (img: HTMLImageElement) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d')!;
        context.drawImage(img, 0, 0);
        return context.getImageData(0, 0, width, height).data;
      };
      const dataA = read(imgA);
      const dataB = read(imgB);
      let diff = 0;
      const seen = new Set<number>();
      for (let i = 0; i < dataA.length; i += 4) {
        const dr = Math.abs(dataA[i]! - dataB[i]!);
        const dg = Math.abs(dataA[i + 1]! - dataB[i + 1]!);
        const db = Math.abs(dataA[i + 2]! - dataB[i + 2]!);
        const da = Math.abs(dataA[i + 3]! - dataB[i + 3]!);
        if (dr > threshold || dg > threshold || db > threshold || da > threshold) diff++;
        if (seen.size < 8) seen.add((dataA[i]! << 16) | (dataA[i + 1]! << 8) | dataA[i + 2]!);
      }
      return {
        fraction: width * height > 0 ? diff / (width * height) : 0,
        widthDiff: Math.abs(imgA.width - imgB.width),
        heightDiff: Math.abs(imgA.height - imgB.height),
        colours: seen.size,
      };
    },
    {
      a: `data:image/png;base64,${shown.toString('base64')}`,
      b: `data:image/png;base64,${copied.toString('base64')}`,
      threshold: channelThreshold,
    },
  );
}

/**
 * A repeat of 32 pixels with lines of 25 percent: the line is 8 pixels, so on a screen of 2.625 device pixels to the CSS
 * pixel (the mobile project) every edge and every tile falls on a whole device pixel and the browser has no sub-pixel
 * edge to round one way in one page and the other way in the other.
 */
async function setWholePixelPattern(page: Page): Promise<void> {
  await page.locator('input[name="pattern"][value="stripes-diagonal"]').check();
  await page.locator('#f-size').fill('32');
  await page.locator('#f-thickness').fill('25');
}

/** The channel threshold and the share of pixels the shared preview spec allows. */
const PATTERN_CHANNEL_THRESHOLD = 2;
const PATTERN_MAX_FRACTION = 0.03;

/**
 * Draws the copied CSS and markup in a blank page and compares that page's pattern with the one the page shows.
 *
 * A pattern in a frame sits a few pixels inside the frame (its border and the frame page's margin: 13 pixels), and on a
 * screen of 2.625 device pixels to the CSS pixel that is not a whole device pixel. The frame itself is placed on a whole
 * device pixel and the blank page gives its element the same 13 pixel offset, so both pages put the pattern at the same
 * fraction of a device pixel; otherwise every edge would differ for that reason alone. A pattern drawn straight into the
 * page is placed on a whole device pixel itself and the blank page's element sits at 8 by 8, also a whole one.
 */
async function expectPatternCopyMatches(
  page: Page,
  context: BrowserContext,
  holder: Locator,
  shown: Locator,
  css: string,
  markup: string,
  label: string,
  inFrame: boolean,
  options: { selector?: string; act?: (blank: Page) => Promise<void> } = {},
): Promise<void> {
  await sitOnWholePixel(page, holder, inFrame ? holder : shown);
  const holderBox = await holder.boundingBox();
  const shownBox = await shown.boundingBox();
  if (!holderBox || !shownBox) throw new Error('the pattern has no box');
  const offsetX = inFrame ? shownBox.x - holderBox.x : 8;
  const offsetY = inFrame ? shownBox.y - holderBox.y : 8;
  const shownPng = await shown.screenshot();
  const blank = await context.newPage();
  try {
    await blank.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body style="margin:${offsetY}px 0 0 ${offsetX}px">${markup}</body></html>`,
    );
    const copied = blank.locator(options.selector ?? '.pattern');
    await expect(copied).toBeVisible();
    // A state the shown element was put in (a checked box, a moved slider) is put on the copy the same way.
    if (options.act) await options.act(blank);
    const copiedPng = await copied.screenshot();
    const result = await comparePatternPixels(blank, shownPng, copiedPng, PATTERN_CHANNEL_THRESHOLD);
    expect(result.widthDiff, `${label}: the copied pattern differs in width`).toBe(0);
    expect(result.heightDiff, `${label}: the copied pattern differs in height`).toBe(0);
    expect(
      result.colours,
      `${label}: the shown pattern is flat, so the comparison would prove nothing`,
    ).toBeGreaterThan(1);
    expect(
      result.fraction,
      `${label}: ${(result.fraction * 100).toFixed(2)}% of pixels differ by more than ${PATTERN_CHANNEL_THRESHOLD} per channel`,
    ).toBeLessThanOrEqual(PATTERN_MAX_FRACTION);
  } finally {
    await blank.close();
  }
}

test('css-pattern: the inline SVG pattern copied into a blank page draws the same pixels as its preview frame', async ({
  browser,
  baseURL,
}, testInfo) => {
  const context = await wholeScaleContext(browser, baseURL, testInfo);
  try {
    await provePatternFrame(await context.newPage(), context);
  } finally {
    await context.close();
  }
});

async function provePatternFrame(page: Page, context: BrowserContext): Promise<void> {
  await openTool(page, 'css-pattern');
  const requests = recordRequests(page);
  await page.locator('input[name="output"][value="svg"]').check();
  await setWholePixelPattern(page);
  for (const pattern of PATTERN_IDS) {
    await page.locator(`input[name="pattern"][value="${pattern}"]`).check();
    await settlePreview(page);
    const frame = page.frameLocator('iframe.preview-frame');
    const shown = frame.locator('.pattern');
    await expect(shown).toBeVisible();

    // The frame holds exactly the CSS the code block offers to copy, and the CSS holds the whole tile.
    const copiedCss = (await outputArea(page).locator('pre').first().innerText()).trim();
    const frameCss = (await frame.locator('body style').evaluate((el) => el.textContent ?? '')).trim();
    expect(frameCss, pattern).toBe(copiedCss);
    expect(copiedCss, pattern).toContain('url("data:image/svg+xml,%3Csvg');

    await expectPatternCopyMatches(
      page,
      context,
      page.locator('iframe.preview-frame'),
      shown,
      copiedCss,
      '<div class="pattern"></div>',
      `${pattern} as SVG`,
      true,
    );
  }
  // The frame loaded a data address and nothing else: the page's own recorder saw only data and blob addresses.
  expect(offending(requests)).toEqual([]);
}

test('css-pattern: every gradient pattern copied into a blank page draws the same pixels as its preview', async ({
  browser,
  baseURL,
}, testInfo) => {
  const context = await wholeScaleContext(browser, baseURL, testInfo);
  try {
    await provePatternGradients(await context.newPage(), context);
  } finally {
    await context.close();
  }
});

async function provePatternGradients(page: Page, context: BrowserContext): Promise<void> {
  await openTool(page, 'css-pattern');
  const requests = recordRequests(page);
  await page.locator('input[name="output"][value="gradient"]').check();
  await setWholePixelPattern(page);
  for (const pattern of PATTERN_IDS) {
    await page.locator(`input[name="pattern"][value="${pattern}"]`).check();
    await settlePreview(page);
    const stage = page.locator('.css-preview-stage');
    const shown = stage.locator('.pattern');
    await expect(shown).toBeVisible();
    const css = await previewCssText(page);
    expect(css, pattern).toContain('gradient(');
    expect(css, pattern).not.toContain('url(');
    await expectPatternCopyMatches(
      page,
      context,
      stage,
      shown,
      css,
      '<div class="pattern"></div>',
      `${pattern} as gradients`,
      false,
    );
  }
  expect(offending(requests)).toEqual([]);
}

// --- Form control styler and cubic-bezier easing editor (plan 15-09) ---------------------------------------------------

const STYLER_CLASSES: Record<string, string> = {
  button: '.fc-button',
  switch: '.fc-switch',
  checkbox: '.fc-check',
  radio: '.fc-radio',
  range: '.fc-range',
};
/** Two presets for each family, six different presets between them: each is operated and its focus ring read. */
const STYLER_OPERATE_CASES: [string, string][] = [
  ['button', 'plain'],
  ['button', 'bold'],
  ['switch', 'pill'],
  ['switch', 'soft'],
  ['checkbox', 'rounded'],
  ['checkbox', 'outline'],
  ['radio', 'bold'],
  ['radio', 'pill'],
  ['range', 'outline'],
  ['range', 'plain'],
];

function stylerFrame(page: Page) {
  return page.frameLocator('iframe.preview-frame');
}

/** True when the control answers a look-up inside the frame within five seconds, asked twice. */
async function frameAnswers(element: Locator): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await Promise.race([
        element.waitFor({ state: 'visible' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('the frame did not answer')), 5_000)),
      ]);
      return true;
    } catch {
      // Asked once more, then given up on.
    }
  }
  return false;
}

/**
 * Chooses a control and a preset on the styler page and waits until the frame shows it. `restore` puts back what the test set
 * on the page before this call (the fields it filled), and `requests` is the test's request recorder, for the case below.
 *
 * Firefox, now and then (measured: about one preview change in a hundred, more when two Firefox runs share the machine),
 * leaves a frame that has just loaded a new document unanswered for good: every look-up inside it waits for ever, though the
 * frame is on screen and working. A look-up is a wait for the element, not an expect, made after the load is over, and when
 * it still gets no answer the page is loaded again once (the page, not the code under test, is what is stuck) and the
 * message is printed.
 */
async function showStyledControl(
  page: Page,
  control: string,
  preset: string,
  again: { restore: () => Promise<void>; requests: string[] } | null = null,
): Promise<Locator> {
  for (let round = 1; ; round++) {
    await page.locator(`input[type="radio"][name="control"][value="${control}"]`).check();
    await page.locator('#f-preset').selectOption(preset);
    await settlePreview(page);
    // The frame loads its new document just after the output settles; the first look-up waits for that load to be over.
    await page.waitForTimeout(400);
    const element = stylerFrame(page).locator(STYLER_CLASSES[control]!).first();
    if (await frameAnswers(element)) return element;
    if (round >= 2)
      throw new Error(`the preview frame did not answer after the page was loaded again (${control} / ${preset})`);
    console.log(
      `NOTE ${test.info().project.name}: the preview frame did not answer for ${control} / ${preset}; the page is loaded again`,
    );
    const seen = again?.requests.length ?? 0;
    await openTool(page, 'form-control-styler');
    await page.waitForLoadState('networkidle');
    await again?.restore();
    // The page's own load is not what the recorder is there to watch.
    if (again) again.requests.length = seen;
  }
}

/** Operates one styled control the way a visitor would, by pointer and by keyboard, inside the frame. */
async function operateStyledControl(page: Page, control: string, element: Locator, label: string): Promise<void> {
  const frame = stylerFrame(page);
  if (control === 'switch' || control === 'checkbox') {
    if (control === 'switch') await expect(element, label).toHaveAttribute('role', 'switch');
    await element.click();
    await expect(element, `${label}: a click`).toBeChecked();
    await element.focus();
    await page.keyboard.press('Space');
    await expect(element, `${label}: the Space key`).not.toBeChecked();
  } else if (control === 'radio') {
    const radios = frame.locator('.fc-radio');
    await radios.first().click();
    await expect(radios.first(), `${label}: a click`).toBeChecked();
    await radios.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(radios.nth(1), `${label}: the arrow key`).toBeChecked();
    await expect(radios.first(), `${label}: the arrow key`).not.toBeChecked();
  } else if (control === 'range') {
    await element.focus();
    const before = Number(await element.inputValue());
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect(Number(await element.inputValue()), `${label}: two ArrowRight presses`).toBe(before + 2);
    // By pointer: a click near the right end of the slider moves it well past where the keys left it.
    const box = await element.boundingBox();
    if (!box) throw new Error('the slider has no box');
    await element.click({ position: { x: box.width - 6, y: box.height / 2 } });
    expect(Number(await element.inputValue()), `${label}: a click near the right end`).toBeGreaterThan(before + 12);
  } else {
    await element.click();
    await expect(element, label).toBeEnabled();
  }
}

/**
 * Tabs into the frame from the last field before it and reads the focus ring of the control that takes focus: a real Tab,
 * so the browser's own :focus-visible rule applies, and an outline of at least 2 pixels drawn solid.
 */
async function expectKeyboardFocusRing(page: Page, control: string, label: string): Promise<void> {
  const target =
    control === 'radio'
      ? stylerFrame(page).locator('.fc-radio:checked')
      : stylerFrame(page).locator(STYLER_CLASSES[control]!).first();
  await page.locator('#f-showDisabled').focus();
  let reached = false;
  for (let i = 0; i < 6 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await target.evaluate((el) => document.activeElement === el);
  }
  expect(reached, `${label}: Tab never reached the control inside the frame`).toBe(true);
  const ring = await target.evaluate((el) => ({
    style: getComputedStyle(el).outlineStyle,
    width: parseFloat(getComputedStyle(el).outlineWidth),
    visible: el.matches(':focus-visible'),
  }));
  expect(ring.visible, `${label}: :focus-visible does not match`).toBe(true);
  expect(ring.style, `${label}: the outline is not solid`).toBe('solid');
  expect(ring.width, `${label}: the outline is under 2 pixels`).toBeGreaterThanOrEqual(2);
}

test('form-control-styler: the styled native controls work by pointer and keyboard inside the frame and keep a visible focus ring', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await openTool(page, 'form-control-styler');
  const requests = recordRequests(page);
  await page.locator('#f-showDisabled').check();
  for (const [control, preset] of STYLER_OPERATE_CASES) {
    const label = `${control} / ${preset}`;
    const element = await showStyledControl(page, control, preset, {
      restore: () => page.locator('#f-showDisabled').check(),
      requests,
    });
    // The disabled copy is a native disabled control: exactly one of them.
    await expect(stylerFrame(page).locator(`${STYLER_CLASSES[control]!}:disabled`), label).toHaveCount(1);
    await operateStyledControl(page, control, element, label);
    await expectKeyboardFocusRing(page, control, label);
  }
  expect(offending(requests)).toEqual([]);
});

/** The states compared against a copy in a blank page: two presets for each family, all six presets between them. */
const STYLER_COPY_CASES: [string, string][] = [
  ['button', 'pill'],
  ['button', 'outline'],
  ['switch', 'rounded'],
  ['switch', 'soft'],
  ['checkbox', 'bold'],
  ['checkbox', 'outline'],
  ['radio', 'plain'],
  ['radio', 'soft'],
  ['range', 'rounded'],
  ['range', 'bold'],
];

/** Puts a styled control in its other state: a box checked, the second radio chosen, a slider at its end. */
async function changeStyledControl(
  root: Page | ReturnType<typeof stylerFrame>,
  owner: Page,
  control: string,
): Promise<void> {
  const cls = STYLER_CLASSES[control]!;
  if (control === 'switch' || control === 'checkbox') {
    await root.locator(`${cls}:not(:disabled)`).first().click();
  } else if (control === 'radio') {
    await root.locator(cls).nth(1).click();
  } else {
    // A slider at its end. The value is set from the page, not by a key press: Firefox sends no key presses to a page that
    // is not the visible tab, which this one is for a moment after the copy's page closes.
    await root
      .locator(cls)
      .first()
      .evaluate((el) => {
        (el as HTMLInputElement).value = (el as HTMLInputElement).max;
      });
  }
  // No focus ring and no hover in either picture: focus nowhere and the pointer away.
  await root.locator('body').evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await owner.mouse.move(0, 0);
  // Both pictures are taken after every transition the change started has ended. The wait is polled from here, not an
  // in-page wait on the transitions: a page that is not yet the visible tab does not run its animation clock (Firefox,
  // right after the copy's page closed), and an in-page wait would then never return.
  await expect
    .poll(() => root.locator('body').evaluate(() => document.getAnimations().length), {
      message: 'a transition did not end',
      timeout: 15_000,
    })
    .toBe(0);
}

test('form-control-styler: the copied CSS and markup draw the same pixels as the preview frame', async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(150_000);
  // The copies are drawn in a second browser context: in Firefox the page that is shown goes quiet for a while whenever a
  // second tab of its own context opens and closes, and the next frame it draws is then not seen for minutes.
  const context = await wholeScaleContext(browser, baseURL, testInfo);
  const copyContext = await wholeScaleContext(browser, baseURL, testInfo);
  try {
    await proveStylerCopies(await context.newPage(), copyContext);
  } finally {
    await copyContext.close();
    await context.close();
  }
});

async function proveStylerCopies(page: Page, copyContext: BrowserContext): Promise<void> {
  await openTool(page, 'form-control-styler');
  const requests = recordRequests(page);
  const setupPage = async () => {
    await page.locator('#f-showDisabled').check();
    await page.locator('input[aria-label="Accent value"]').fill('#7c3aed');
    await page.locator('input[aria-label="Background value"]').fill('#f5f3ff');
  };
  await setupPage();
  for (const [control, preset] of STYLER_COPY_CASES) {
    const label = `${control} / ${preset}`;
    await showStyledControl(page, control, preset, { restore: setupPage, requests });
    const frame = stylerFrame(page);
    const surface = frame.locator('.fc-surface');
    await surface.waitFor({ state: 'visible' });

    // The code blocks are what a visitor copies: the CSS first, then the markup. The frame holds exactly that CSS.
    const css = (await outputArea(page).locator('pre').first().innerText()).trim();
    const markup = (await outputArea(page).locator('pre').nth(1).innerText()).trim();
    const frameCss = (await frame.locator('body style').evaluate((el) => el.textContent ?? '')).trim();
    expect(frameCss, label).toBe(css);
    expect(css, label).toContain('#7c3aed');
    expect(markup, label).toContain(STYLER_CLASSES[control]!.slice(1));

    const holder = page.locator('iframe.preview-frame');
    await page.mouse.move(0, 0);
    await expectPatternCopyMatches(page, copyContext, holder, surface, css, markup, label, true, {
      selector: '.fc-surface',
    });

    // The other state: the same change made in the frame and in the copy, and the pictures compared again.
    if (control !== 'button') {
      await changeStyledControl(frame, page, control);
      await expectPatternCopyMatches(page, copyContext, holder, surface, css, markup, `${label} changed`, true, {
        selector: '.fc-surface',
        act: (blank) => changeStyledControl(blank, blank, control),
      });
    }
  }
  expect(offending(requests)).toEqual([]);
}

test('form-control-styler: under reduced motion the styled controls have no transition', async ({ page }) => {
  test.setTimeout(90_000);
  await openTool(page, 'form-control-styler');
  const requests = recordRequests(page);
  for (const control of Object.keys(STYLER_CLASSES)) {
    const element = await showStyledControl(page, control, 'rounded');
    const css = (await outputArea(page).locator('pre').first().innerText()).trim();
    expect(css, control).toContain('@media (prefers-reduced-motion: reduce) {');
    const reducedBlock = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {'));
    expect(reducedBlock, control).toContain('transition: none');

    // Every element and pseudo-element a family gives a transition to (the slider's thumb parts cannot be read by
    // script in every browser, so its rules are checked in the CSS text above).
    const targets: (string | null)[] = control === 'switch' ? [null, '::before'] : control === 'range' ? [] : [null];
    for (const pseudo of targets) {
      const durations = async () =>
        element.evaluate(
          (el, which) =>
            getComputedStyle(el, which)
              .transitionDuration.split(',')
              .map((d) => parseFloat(d)),
          pseudo,
        );
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await expect
        .poll(async () => (await durations()).some((d) => d > 0), {
          message: `${control} ${pseudo ?? ''} should have a transition without the preference`,
        })
        .toBe(true);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), control).toBe(true);
      await expect
        .poll(async () => (await durations()).every((d) => d === 0), {
          message: `${control} ${pseudo ?? ''} should have no transition under reduced motion`,
        })
        .toBe(true);
    }
    if (control === 'range') {
      for (const part of ['::-webkit-slider-thumb', '::-moz-range-thumb']) {
        expect(reducedBlock, `${control} ${part}`).toContain(`.fc-range${part} {\n  transition: none;\n}`);
      }
    }
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
  expect(offending(requests)).toEqual([]);
});

/** A small seeded generator, so the curves compared with the browser are the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Fills one of a handle pad's number boxes. The pad rounds what it is given to its step of 0.01, which can leave a little
 * floating-point noise in the box (0.8200000000000001), so the box is checked to six decimals, not as text.
 */
async function fillPadNumber(page: Page, name: string, value: number): Promise<void> {
  const field = page.locator(`#f-${name}`);
  await expect(async () => {
    await field.fill(String(value));
    expect(Number(await field.inputValue())).toBeCloseTo(value, 6);
  }).toPass({ timeout: 10_000 });
}

/** The most the page's table may differ from the browser's own animation engine: 1e-6, or what an engine's own solver needs. */
const ENGINE_TOLERANCE: Record<string, number> = { chromium: 1e-6, firefox: 1e-6, webkit: 1e-6 };

/**
 * Reads the value and the eleven sampled rows the page prints, asks the browser's Web Animations engine for the progress of
 * an animation with that easing at the same eleven times (a one second animation paused at 0, 100 ... 1000 ms), and returns
 * the largest difference.
 */
async function compareWithEngine(page: Page, label: string, expectedValue: string | null): Promise<number> {
  const value = (await codeText(page)).split('\n')[0]!.trim();
  if (expectedValue !== null) expect(value, label).toBe(expectedValue);
  const printed = await outputArea(page)
    .locator('table tbody tr')
    .evaluateAll((rows) =>
      rows.map((row) => Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent ?? '')),
    );
  expect(
    printed.map((row) => row[0]),
    label,
  ).toEqual(['0.0', '0.1', '0.2', '0.3', '0.4', '0.5', '0.6', '0.7', '0.8', '0.9', '1.0']);
  const engine = await page.evaluate((easing) => {
    const animation = document.body.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 1000,
      easing,
      fill: 'both',
    });
    animation.pause();
    const progress: (number | null)[] = [];
    for (let i = 0; i <= 10; i++) {
      animation.currentTime = i * 100;
      progress.push(animation.effect!.getComputedTiming().progress ?? null);
    }
    animation.cancel();
    return progress;
  }, value);
  let worst = 0;
  for (let i = 0; i <= 10; i++) {
    expect(engine[i], `${label}: the engine gave no progress at ${i / 10}`).not.toBeNull();
    worst = Math.max(worst, Math.abs(Number(printed[i]![1]) - engine[i]!));
  }
  return worst;
}

test('cubic-bezier: the sampled curve agrees with the browser animation engine for the keyword curves and seeded custom curves', async ({
  page,
  browserName,
}) => {
  test.setTimeout(120_000);
  await openTool(page, 'cubic-bezier');
  const requests = recordRequests(page);
  const tolerance = ENGINE_TOLERANCE[browserName] ?? 1e-6;
  let worst = 0;

  for (const keyword of ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']) {
    await page.locator('#f-preset').selectOption(keyword);
    await settlePreview(page);
    const difference = await compareWithEngine(page, keyword, null);
    expect(difference, `${keyword}: the table differs from the animation engine`).toBeLessThanOrEqual(tolerance);
    worst = Math.max(worst, difference);
  }

  // Ten curves from a seeded generator, entered through the pad's numeric inputs as (x, 1 - y), with y from -1 to 2.
  await page.locator('#f-preset').selectOption('custom');
  const random = mulberry32(20261003);
  for (let i = 0; i < 10; i++) {
    const pads = [round2(random()), round2(random() * 3 - 1), round2(random()), round2(random() * 3 - 1)];
    const [x1, y1, x2, y2] = [pads[0]!, round2(1 - pads[1]!), pads[2]!, round2(1 - pads[3]!)];
    await fillPadNumber(page, 'p1-x', pads[0]!);
    await fillPadNumber(page, 'p1-y', pads[1]!);
    await fillPadNumber(page, 'p2-x', pads[2]!);
    await fillPadNumber(page, 'p2-y', pads[3]!);
    await settlePreview(page);
    const difference = await compareWithEngine(page, `curve ${i + 1}`, `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`);
    expect(
      difference,
      `curve ${i + 1} (${x1}, ${y1}, ${x2}, ${y2}): the table differs from the animation engine`,
    ).toBeLessThanOrEqual(tolerance);
    worst = Math.max(worst, difference);
  }
  console.log(
    `ORACLE ${browserName}: largest difference from the animation engine over 15 curves ${worst.toExponential(3)}`,
  );
  expect(offending(requests)).toEqual([]);
});

/** Clicks Download in the SVG block of the chart page and returns the text of the file that was saved. */
async function downloadChartSvg(page: Page): Promise<string> {
  const block = outputArea(page)
    .locator('.output-block')
    .filter({ has: page.locator('.output-label span', { hasText: /^SVG$/ }) });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    block.getByRole('button', { name: 'Download' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('chart.svg');
  return readFileSync(await download.path(), 'utf8');
}

/** Opens a blank page in the same browser and puts the SVG text in it inline, as a visitor who saved the file would. */
async function inlineChart(page: Page, svg: string): Promise<Page> {
  const blank = await page.context().newPage();
  await blank.setContent(`<!doctype html><html><body>${svg}</body></html>`);
  return blank;
}

test('chart-maker: bar heights in the browser are proportional to the values and every bar is announced with its label and value', async ({
  page,
  browserName,
}) => {
  test.setTimeout(90_000);
  await openTool(page, 'chart-maker');
  const requests = recordRequests(page);

  const values = [3, 5, 8, 0, 6.5];
  const labels = ['Apples', 'Pears', 'Cherries', 'Plums', 'Figs'];
  await fillField(page, 'data', 'Fruit,Count\n' + labels.map((label, i) => `${label},${values[i]}`).join('\n'));
  await page.locator('input[name="type"][value="bar"]').check();
  await fillField(page, 'title', 'Fruit sold');
  await fillField(page, 'xLabel', 'Fruit');
  await fillField(page, 'yLabel', 'Number sold');
  await expect(outputArea(page).locator('pre.output').first()).toContainText('Figs: 6.5', { timeout: 10_000 });

  // The file a visitor saves, placed inline in a blank page.
  const svg = await downloadChartSvg(page);
  const blank = await inlineChart(page, svg);
  try {
    // Every bar's height is its value times one scale, to half a pixel, and the bars stand on one baseline.
    const bars = await blank.evaluate(() =>
      Array.from(document.querySelectorAll('[role="graphics-symbol"]')).map((element) => {
        const box = (element as unknown as SVGGraphicsElement).getBBox();
        return { label: element.getAttribute('aria-label'), height: box.height, bottom: box.y + box.height };
      }),
    );
    expect(bars.map((bar) => bar.label)).toEqual(labels.map((label, i) => `${label}: ${values[i]}`));
    const scale = bars[2]!.height / 8;
    expect(scale, 'the tallest bar should be many pixels tall').toBeGreaterThan(10);
    values.forEach((value, i) => {
      expect(
        Math.abs(bars[i]!.height - value * scale),
        `${labels[i]}: ${bars[i]!.height} for ${value}`,
      ).toBeLessThanOrEqual(0.5);
      // A bar of no height has an empty box in Firefox and WebKit, so only bars with some height are compared.
      if (value > 0) expect(Math.abs(bars[i]!.bottom - bars[0]!.bottom)).toBeLessThanOrEqual(0.05);
    });
    expect(bars[3]!.height).toBe(0);

    // The chart is named by its title and described by its description; every bar is named by its label and value.
    const description =
      'Horizontal axis: Fruit. Vertical axis: Number sold. Count: 5 values, from 0 (Plums) to 8 (Cherries), averaging 4.5.';
    const root = blank.locator('svg[role="graphics-document"]');
    await expect(root).toHaveAccessibleName('Fruit sold');
    await expect(root).toHaveAccessibleDescription(description);
    // The wiring itself: the ids that aria-labelledby and aria-describedby name are on the title and the description
    // elements (a browser also falls back to the title element, so the name alone would not show a broken id).
    const wiring = await blank.evaluate(() => {
      const chart = document.querySelector('svg[role="graphics-document"]')!;
      const texts = (attribute: string) =>
        (chart.getAttribute(attribute) ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? null);
      return { title: texts('aria-labelledby'), description: texts('aria-describedby') };
    });
    expect(wiring).toEqual({ title: ['Fruit sold'], description: [description] });
    const marks = blank.locator('[role="graphics-symbol"]');
    await expect(marks).toHaveCount(values.length);
    for (let i = 0; i < values.length; i++)
      await expect(marks.nth(i)).toHaveAccessibleName(`${labels[i]}: ${values[i]}`);

    // In Chromium the browser's own accessibility tree can be read: the document named by the title holds the series,
    // which holds one item per bar, and the gridlines, numbers and legend are not in the tree at all. (Playwright has no
    // way to read the tree of Firefox or WebKit; there the names above are computed by Playwright's own implementation of
    // the accessible name rules.)
    if (browserName === 'chromium') {
      const session = await blank.context().newCDPSession(blank);
      const { nodes } = (await session.send('Accessibility.getFullAXTree')) as {
        nodes: {
          nodeId: string;
          ignored?: boolean;
          role?: { value: string };
          name?: { value: string };
          childIds?: string[];
        }[];
      };
      const live = nodes.filter((node) => node.ignored !== true);
      const byId = new Map(nodes.map((node) => [node.nodeId, node]));
      const documents = live.filter((node) => node.role?.value === 'graphics-document');
      expect(documents.map((node) => node.name?.value)).toEqual(['Fruit sold']);
      const series = (documents[0]!.childIds ?? []).map((id) => byId.get(id)!).filter((node) => node.ignored !== true);
      expect(series.map((node) => [node.role?.value, node.name?.value])).toEqual([['graphics-object', 'Count']]);
      const items = (series[0]!.childIds ?? []).map((id) => byId.get(id)!);
      expect(items.map((node) => [node.role?.value, node.name?.value])).toEqual(
        labels.map((label, i) => ['graphics-symbol', `${label}: ${values[i]}`]),
      );
      expect(live.filter((node) => node.role?.value === 'graphics-symbol')).toHaveLength(values.length);
    }
  } finally {
    await blank.close();
  }
  expect(offending(requests)).toEqual([]);
});

test('chart-maker: pie slices cover the full circle in proportion and the PNG matches the chart size', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openTool(page, 'chart-maker');
  const requests = recordRequests(page);

  const shares = [3, 5, 40, 1.5, 12.5];
  const total = shares.reduce((sum, share) => sum + share, 0);
  const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
  await fillField(page, 'data', 'Share,Value\n' + names.map((name, i) => `${name},${shares[i]}`).join('\n'));
  await page.locator('input[name="type"][value="pie"]').check();
  await fillField(page, 'title', 'Shares');
  await page.locator('input[name="format"][value="png"]').check();
  await expect(outputArea(page).locator('li', { hasText: 'chart.png' })).toBeVisible({ timeout: 10_000 });
  const svg = await downloadChartSvg(page);
  const png = await downloadNamed(page, 'chart.png');

  // The slices drawn by the browser's own geometry: walking round the circle in steps of a twentieth of a degree from
  // twelve o'clock, every point is inside exactly one slice, and the slice changes within a step of where the values say.
  const blank = await inlineChart(page, svg);
  try {
    const walk = await blank.evaluate(() => {
      const paths = Array.from(document.querySelectorAll('path[role="graphics-symbol"]')) as SVGPathElement[];
      const read = paths.map((path) => {
        const parts = /^M (\S+) (\S+) L \S+ \S+ A (\S+)/.exec(path.getAttribute('d') ?? '')!;
        return { cx: Number(parts[1]), cy: Number(parts[2]), r: Number(parts[3]) };
      });
      const { cx, cy, r } = read[0]!;
      const result: { radius: number; none: number; several: number; changes: [number, number][] }[] = [];
      for (const radius of [0.9, 0.3]) {
        let previous = -1;
        let none = 0;
        let several = 0;
        const changes: [number, number][] = [];
        for (let step = 0; step < 7200; step++) {
          const degrees = 0.025 + step * 0.05;
          const angle = ((-90 + degrees) * Math.PI) / 180;
          const point = new DOMPoint(cx + r * radius * Math.cos(angle), cy + r * radius * Math.sin(angle));
          const owners = paths.flatMap((path, index) => (path.isPointInFill(point) ? [index] : []));
          if (owners.length === 0) none++;
          else if (owners.length > 1) several++;
          const owner = owners.length === 1 ? owners[0]! : -1;
          if (step > 0 && owner !== previous && owner >= 0) changes.push([degrees, owner]);
          previous = owner;
        }
        result.push({ radius, none, several, changes });
      }
      return { paths: paths.length, rings: result };
    });
    expect(walk.paths).toBe(shares.length);
    // The boundaries are the running totals of the values over the total, times 360 degrees.
    let running = 0;
    const boundaries = shares.slice(0, -1).map((share) => {
      running += share;
      return (running / total) * 360;
    });
    for (const ring of walk.rings) {
      expect(ring.none, `radius ${ring.radius}: points in no slice`).toBe(0);
      expect(ring.several, `radius ${ring.radius}: points in two slices`).toBe(0);
      // The walk starts inside slice 0, so the changes are into slices 1 to 4, in order.
      expect(ring.changes.map(([, owner]) => owner)).toEqual([1, 2, 3, 4]);
      ring.changes.forEach(([degrees], i) => {
        expect(degrees - boundaries[i]!, `radius ${ring.radius}: boundary ${i + 1} at ${degrees}`).toBeGreaterThan(
          -0.001,
        );
        expect(degrees - boundaries[i]!).toBeLessThanOrEqual(0.05 + 0.001);
      });
    }
  } finally {
    await blank.close();
  }

  // The PNG is the chart drawn twice its size (800 by 480), is not one colour, is white where the chart has no ink, and
  // shows each slice's own fill colour at that slice's middle. The positions come from the SVG's own numbers.
  const image = decodePngBytes(png);
  expect([image.width, image.height]).toEqual([1600, 960]);
  const colours = new Set<number>();
  for (let i = 0; i < image.width * image.height; i++) {
    colours.add((image.rgba[i * 4]! << 16) | (image.rgba[i * 4 + 1]! << 8) | image.rgba[i * 4 + 2]!);
  }
  expect(colours.size, 'the PNG should hold the slices, the outlines and the text').toBeGreaterThanOrEqual(8);
  const pixel = (x: number, y: number): number[] => {
    const at = (Math.round(y) * image.width + Math.round(x)) * 4;
    return [image.rgba[at]!, image.rgba[at + 1]!, image.rgba[at + 2]!];
  };
  expect(pixel(2, 2)).toEqual([255, 255, 255]);
  expect(pixel(image.width - 3, image.height - 3)).toEqual([255, 255, 255]);
  const slices = [...svg.matchAll(/<path\b[^>]*role="graphics-symbol"[^>]*>/g)].map((match) => {
    const tag = match[0];
    const d = /\sd="M (\S+) (\S+) L \S+ \S+ A (\S+)/.exec(tag)!;
    return { cx: Number(d[1]), cy: Number(d[2]), r: Number(d[3]), fill: /\sfill="#([0-9a-f]{6})"/.exec(tag)![1]! };
  });
  expect(slices).toHaveLength(shares.length);
  let before = 0;
  slices.forEach((slice, i) => {
    const middle = ((-90 + ((before + shares[i]! / 2) / total) * 360) * Math.PI) / 180;
    before += shares[i]!;
    const [r, g, b] = pixel(
      2 * (slice.cx + slice.r * 0.6 * Math.cos(middle)),
      2 * (slice.cy + slice.r * 0.6 * Math.sin(middle)),
    );
    const want = [
      parseInt(slice.fill.slice(0, 2), 16),
      parseInt(slice.fill.slice(2, 4), 16),
      parseInt(slice.fill.slice(4, 6), 16),
    ];
    expect(
      Math.max(Math.abs(r! - want[0]!), Math.abs(g! - want[1]!), Math.abs(b! - want[2]!)),
      `${names[i]} at its middle`,
    ).toBeLessThanOrEqual(3);
  });
  expect(offending(requests)).toEqual([]);
});
