/**
 * Byte, entry and ratio limits enforced on bytes this package actually
 * produces while extracting an archive -- never on a header's own declared
 * size, which a hostile archive can lie about freely (a "zip bomb" declares
 * a small compressed size and an enormous uncompressed one, or nothing at
 * all when the size lives only in a data descriptor written after the
 * data). David Fifield's "A better zip bomb" (https://www.bamsoftware.com/
 * hacks/zipbomb/) documents the overlapping-entry construction this
 * project's own central-directory overlap check (in `zip-read.ts`) exists
 * to refuse outright, precisely because a ratio or total-size limit alone
 * cannot catch entries that share the same compressed bytes.
 */

export interface ArchiveLimits {
  /** A picked file over this many bytes is refused before any parsing starts. */
  maxInputBytes: number;
  /** Extraction stops once this many decompressed bytes have been produced, across every entry. */
  maxTotalOutputBytes: number;
  /** An archive with more central-directory (or TAR header) entries than this is refused up front. */
  maxEntries: number;
  /**
   * Once a single entry has produced at least 1 MiB, its own
   * produced-bytes-to-consumed-bytes ratio is charged against this limit;
   * crossing it stops the entry (and the whole run) even though the total
   * output budget has not been crossed, since a small compressed input can
   * still expand to something enormous well before the total limit fires.
   */
  maxRatio: number;
  /** Compressed input is fed to the inflater in pieces this large, bounding how much one step can produce. */
  feedChunkBytes: number;
}

export const ARCHIVE_LIMITS: ArchiveLimits = {
  maxInputBytes: 2 * 1024 * 1024 * 1024, // 2 GiB
  maxTotalOutputBytes: 256 * 1024 * 1024, // 256 MiB
  maxEntries: 10_000,
  maxRatio: 250,
  feedChunkBytes: 16 * 1024, // 16 KiB
};

/** The number of produced bytes at which an entry's own ratio starts being checked. */
export const RATIO_CHECK_THRESHOLD_BYTES = 1024 * 1024; // 1 MiB

export class ArchiveLimitError extends Error {
  readonly limit: 'total-output' | 'ratio' | 'entries' | 'input-size';
  constructor(message: string, limit: 'total-output' | 'ratio' | 'entries' | 'input-size') {
    super(message);
    this.name = 'ArchiveLimitError';
    this.limit = limit;
  }
}

/**
 * Charges every produced (decompressed, or copied for a stored entry) byte
 * against a run-wide total and a per-entry ratio, throwing `ArchiveLimitError`
 * the instant either is crossed -- not after the fact, so a bomb is stopped
 * mid-stream rather than only reported once it has already been fully
 * materialised in memory. One instance is shared by every entry in a run
 * for the total; `startEntry` resets only the per-entry consumed/produced
 * counters the ratio check reads.
 */
export class OutputBudget {
  private totalProduced = 0;
  private entryProduced = 0;
  private entryConsumed = 0;
  constructor(private readonly limits: ArchiveLimits = ARCHIVE_LIMITS) {}

  /** Call once per entry, before feeding it any compressed bytes. */
  startEntry(): void {
    this.entryProduced = 0;
    this.entryConsumed = 0;
  }

  /** Total decompressed bytes produced across every entry so far in this run. */
  get total(): number {
    return this.totalProduced;
  }

  /**
   * Records that `consumedBytes` of compressed input were fed in to produce
   * `producedBytes` of output for the current entry, and throws when either
   * limit is now crossed.
   */
  charge(producedBytes: number, consumedBytes: number): void {
    this.entryProduced += producedBytes;
    this.entryConsumed += consumedBytes;
    this.totalProduced += producedBytes;

    if (this.totalProduced > this.limits.maxTotalOutputBytes) {
      throw new ArchiveLimitError(
        `Stopped: this archive would expand to more than ${Math.round(this.limits.maxTotalOutputBytes / (1024 * 1024))} MB`,
        'total-output',
      );
    }

    if (this.entryProduced > RATIO_CHECK_THRESHOLD_BYTES && this.entryConsumed > 0) {
      const ratio = this.entryProduced / this.entryConsumed;
      if (ratio > this.limits.maxRatio) {
        throw new ArchiveLimitError(
          `Stopped: an entry expands more than ${this.limits.maxRatio} times its packed size, which is how decompression bombs work`,
          'ratio',
        );
      }
    }
  }
}

/** Refuses an archive whose own declared entry count is already over the limit, before anything is inflated. */
export function assertEntryCountWithinLimit(count: number, limits: ArchiveLimits = ARCHIVE_LIMITS): void {
  if (count > limits.maxEntries) {
    throw new ArchiveLimitError(`Stopped: this archive lists more than ${limits.maxEntries} entries`, 'entries');
  }
}
