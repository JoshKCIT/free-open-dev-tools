import { test, expect, type Page } from '@playwright/test';
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { buildFixtureFile } from './fixture-files';

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
  'JVBERi0xLjUKJb/3ov4KMSAwIG9iago8PCAvVHlwZSAvT2JqU3RtIC9MZW5ndGggNTk2IC9GaWx0ZXIgL0ZsYXRlRGVjb2RlIC9OIDkgL0ZpcnN0IDU0ID4+CnN0cmVhbQp4nNVUTW+bQBC991fMLbEqwgLGNlVkCWOs0vhLgBs1UQ4bmLi0Nmux6zTur++w2AltDs2tqoRmB/bN4+3b2bWBgQN2D7pgWQNwwbZs6IHbY9CHfrcHA/AcGzywGHMogOU43rvLSzAnFhUyiCmzqbrOhkM9M+ISJ6JUYH7EzSOqIuNghmUm8qJcg3ldlH4pi5cPc75FzWcm+3t12NFLStFqBpqpuV5xp8UWpRGLLS/fwm6/hT2gHEslyYtmaVMu1YyIHgrM4Xz8wWY2YxYFh3WZe9MBc4Z5wUfiCW6pgoHruRd23yXfutbFYOAN4K7GKJ5zxYG81bRLXtFvajub1wIzjMoHAbWI2cHf7XT2978vq+KRK9ToBLMKFZwn4TyN5uHUWEZhEEbzycK4IexweHzMGKXYVxlKXabXf9JViSwhjltKxxNyCJ/I6WjL1zg6jsFxjGhhmkyoWgAjcMVLTVl/brxdEvC1t8e2eYtzfxj1r5V3/zPlL43nnhpvjdRRBFtJnIvyiJfPOhuOgGo2Yn2i8ffqq6haneWv0o+L2PBzDlPxiBueITVjUCFXhSjHtbhX7fqe2WeMnZ1wv/EFceinRHhdFQor8GrQXiqxvcJDG7ZK0sXM+OxPVyFBaPKHqHLZQlyFX64X8Tgxng4/68Mp8paYZyms15wdke8zbOtYxovxKghjY8a/04TT0ZfGN8zaxypZjT6FQWp41n3Wqe8htcHWdBql09DoPzi8o/dnt6PDa074RrYaak/779AKClJ/C83m9HTs63jX3k1Z1/0C2mWVggplbmRzdHJlYW0KZW5kb2JqCjExIDAgb2JqCjw8IC9MZW5ndGggMTc2IC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+CnN0cmVhbQp4nG2OywqCQBSG9z7Fv6yIyaOm1SqCWrUImheY9HgJRyUNevzGycogzmXxc76PQ3BNkd2xBnYSiwOBPMgUFIgA8oi9dN55YPNQrL45DYrIQxS6kBqTk8rYJDmrpKiyKeQVcvbReCCyGl94/zX+SyPzooXpsqgYdT8pGqsWv84x279u2DPHdZVYdD5AG1R3feFbC19QQMs1lLlgrYoSHbfdlh9KNyWLuNYjP5wn+kdJbAplbmRzdHJlYW0KZW5kb2JqCjEyIDAgb2JqCjw8IC9TdWJ0eXBlIC9YTUwgL1R5cGUgL01ldGFkYXRhIC9MZW5ndGggMjM2IC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+CnN0cmVhbQp4nF1QS07DMBS8SmTWjpsgFrGcVIiGj0SillaCbWo/WquJY9lGMbkaC47EFXBRFKTu5o3mzWiGLb1u+AlctIeDVDn6+fpGkRQ5er2pFpW+g6N8HA1sx3rHxxPPBFoWzFPf6Q5cE/muVZb6HDWi3wMN+EwTVDAj3unL6n5ShCtHR+c0JWQYhni4jntzIEmWZWSRkjTFQYHtp3KNx8peTQYrsNxI7WSvJiPBZx/9Ydo/F8EJtNCBcpYkcXJOF5yK/99iW9a7p7p8xuvbhxK/VWu82TByIWLkInJiQouA5s4FmzcDFYYawiK/e49wBAplbmRzdHJlYW0KZW5kb2JqCjEzIDAgb2JqCjw8IC9MZW5ndGggMTc2IC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+CnN0cmVhbQp4nG2OywqCQBSG9z7Fv6yIyTOaVqsIatUiaF5g0uMlHJU06PHTycogzmXxc76PQ3C7IrsjA+wUFgcCSagE5Asf6oi9ct65b/NArL45DYpQIgxcKIPJSacMiYx1nJfpFOoKNftoJIisxhPyv8Z7aVSWN+i6yEtG1U+C2qrFr3PM9q937JmjqowtOh+gDcq7ufCtgSfIp+Uaurtgo/MCLTftlh/a1AWLqDIjP5wn+7pJbwplbmRzdHJlYW0KZW5kb2JqCjE0IDAgb2JqCjw8IC9MZW5ndGggMTc2IC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+CnN0cmVhbQp4nG2OywqCQBSG9z7Fv6yIyaOm1SqCWrUImheY9HgJRyUNevzGycogzmXxc76PQ3BNkd2xBnYSiwOBPMgUFIgA8oi9dN55YPNQrL45DYrIQxS6kBqTk8oYPnJWSVFlU8gr5Oyj8UBkNb7w/mv8l0bmRQvTZVEx6n5SNFYtfp1jtn/dsGeO6yqx6HyANqju+sK31vAU0HINZS5Yq6JEx2235YfSTckirvXID+cJ/S1JcgplbmRzdHJlYW0KZW5kb2JqCjE1IDAgb2JqCjw8IC9TdWJ0eXBlIC9YTUwgL1R5cGUgL01ldGFkYXRhIC9MZW5ndGggNjM3ID4+CnN0cmVhbQo8P3hwYWNrZXQgYmVnaW49Iu+7vyIgaWQ9Ilc1TTBNcENlaGlIenJlU3pOVGN6a2M5ZCI/Pgo8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJwaWtlcGRmIj4KIDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+CiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIj48ZGM6dGl0bGUgeG1sbnM6ZGM9Imh0dHA6Ly9wdXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvIj48cmRmOkFsdD48cmRmOmxpIHhtbDpsYW5nPSJ4LWRlZmF1bHQiPlNFTlRJTkVMLVhNUC1USVRMRS01NWFhPC9yZGY6bGk+PC9yZGY6QWx0PjwvZGM6dGl0bGU+PGRjOmNyZWF0b3IgeG1sbnM6ZGM9Imh0dHA6Ly9wdXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvIj48cmRmOlNlcT48cmRmOmxpPlNFTlRJTkVMLVhNUC1DUkVBVE9SLUJvYjwvcmRmOmxpPjwvcmRmOlNlcT48L2RjOmNyZWF0b3I+PHhtcDpDcmVhdG9yVG9vbCB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iPlNFTlRJTkVMLVhNUC1UT09MPC94bXA6Q3JlYXRvclRvb2w+PC9yZGY6RGVzY3JpcHRpb24+PC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4KCjw/eHBhY2tldCBlbmQ9InciPz4KCmVuZHN0cmVhbQplbmRvYmoKMTYgMCBvYmoKPDwgL1R5cGUgL1hSZWYgL0xlbmd0aCA0NCAvRmlsdGVyIC9GbGF0ZURlY29kZSAvRGVjb2RlUGFybXMgPDwgL0NvbHVtbnMgNCAvUHJlZGljdG9yIDEyID4+IC9XIFsgMSAyIDEgXSAvSW5mbyA5IDAgUiAvUm9vdCA4IDAgUiAvU2l6ZSAxNyAvSUQgWzw5YTRhYWIzNzVjNDE0N2ZkYWFjMTJiNGI3MDcxZmFmYz48MjE3ZDJkMWM4NTA0NTRmNGI0Mjc1MDU5MDkyOGE5MTU+XSA+PgpzdHJlYW0KeJxjYgACJkYGfhDxiYEJyGMkhvjPdPwHEwPjT6AOpmAGKAvCPc8AAMufCAIKZW5kc3RyZWFtCmVuZG9iagpzdGFydHhyZWYKMjUxNwolJUVPRgo=';
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
