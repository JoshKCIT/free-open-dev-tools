import meta from './meta.json';
import { EMOJI, EMOJI_DATA_VERSION, FULLY_QUALIFIED_COUNT } from './emoji-data';

export { meta, EMOJI, EMOJI_DATA_VERSION, FULLY_QUALIFIED_COUNT };

export interface EmojiEntry {
  codePoints: number[];
  character: string;
  name: string;
  group: string;
  subgroup: string;
  emojiVersion: string;
}

export interface EmojiForms {
  character: string;
  codePoints: string;
  jsEscape: string;
  utf16Escape: string;
  htmlEntity: string;
}

export interface EmojiSearchResult {
  results: EmojiEntry[];
  totalMatches: number;
}

export function searchEmoji(_query: string, _limit = 200): EmojiSearchResult {
  throw new Error('not implemented');
}

export function formsOf(_entry: EmojiEntry): EmojiForms {
  throw new Error('not implemented');
}
