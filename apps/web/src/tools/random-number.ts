import {
  meta,
  generate,
  RandomNumberError,
  type RandomNumberSource,
  DICE_GRAMMAR,
  DiceError,
  RandomDrawError,
  parseDiceNotation,
  rollDice,
  flipCoins,
  drawLottery,
  pickItems,
  readItemLines,
} from '@fodt/random-number';
import { defineTool, str, bool, num, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

// --- The four newer modes: dice, coin flips, lottery draws and list picks (always the cryptographic source) ---

const GRAMMAR_LINES = DICE_GRAMMAR.split('\n');
const SOURCE_STAT: [string, string] = ['Source', 'crypto.getRandomValues'];

/** The grammar, shown with every dice answer and every dice refusal so the rules are always on screen. */
function grammarBlocks(): OutputBlock[] {
  return [
    { kind: 'list', label: 'Dice grammar', items: GRAMMAR_LINES.slice(0, 4) },
    { kind: 'note', tone: 'info', value: GRAMMAR_LINES.slice(4).join(' ') },
  ];
}

/** A number field that must hold a whole number inside its range; anything else is refused naming the field. */
function wholeNumber(
  values: Values,
  field: string,
  label: string,
  fallback: number,
  low: number,
  high: number,
  rangeText: string,
): { value: number } | { message: string } {
  const value = num(values, field, fallback);
  if (!Number.isInteger(value) || value < low || value > high) {
    return { message: `${label} must be a whole number from ${rangeText}.` };
  }
  return { value };
}

const refusal = (message: string, outputs: OutputBlock[] = []): ToolResult => ({ outputs, errors: [{ message }] });

function runDice(values: Values): ToolResult {
  const text = str(values, 'notation', '2d6+3');
  if (text.trim() === '') return { outputs: [] };
  try {
    const roll = rollDice(parseDiceNotation(text));
    const list = (numbers: number[]) => (numbers.length === 0 ? 'none' : numbers.join(', '));
    return {
      outputs: [
        { kind: 'code', label: 'Total', value: String(roll.total) },
        {
          kind: 'table',
          label: 'Each term',
          table: {
            headers: ['Term', 'Dice rolled', 'Kept', 'Dropped', 'Subtotal'],
            rows: roll.terms.map((term) => [
              term.notation,
              list(term.rolls),
              list(term.kept),
              list(term.dropped),
              term.subtotal,
            ]),
            mono: [0, 1, 2, 3, 4],
          },
        },
        ...grammarBlocks(),
      ],
      stats: [['Dice rolled', String(roll.diceRolled)], SOURCE_STAT],
    };
  } catch (err) {
    if (err instanceof DiceError || err instanceof RandomDrawError) return refusal(err.message, grammarBlocks());
    throw err;
  }
}

function runCoin(values: Values): ToolResult {
  const flips = wholeNumber(values, 'flips', 'Flips', 10, 1, 10_000, '1 to 10,000');
  if ('message' in flips) return refusal(flips.message);
  try {
    const result = flipCoins(flips.value);
    return {
      outputs: [
        {
          kind: 'code',
          label: `${flips.value} coin flip${flips.value === 1 ? '' : 's'}`,
          value: result.flips.join('\n'),
          download: 'coin-flips.txt',
        },
      ],
      stats: [['Heads', String(result.heads)], ['Tails', String(result.tails)], SOURCE_STAT],
    };
  } catch (err) {
    if (err instanceof RandomDrawError) return refusal(err.message);
    throw err;
  }
}

function runLottery(values: Values): ToolResult {
  const pool = wholeNumber(values, 'poolSize', 'Pool size', 49, 2, 1_000_000, '2 to 1,000,000');
  if ('message' in pool) return refusal(pool.message);
  const draw = wholeNumber(values, 'drawSize', 'Draw size', 6, 1, 10_000, '1 to 10,000');
  if ('message' in draw) return refusal(draw.message);
  try {
    const result = drawLottery({ poolSize: pool.value, drawSize: draw.value });
    return {
      outputs: [
        { kind: 'code', label: 'Drawn in order', value: result.drawOrder.join(', ') },
        { kind: 'code', label: 'Sorted', value: result.sorted.join(', '), download: 'lottery-numbers.txt' },
      ],
      stats: [['Pool', `1 to ${pool.value}`], ['Numbers drawn', String(draw.value)], SOURCE_STAT],
    };
  } catch (err) {
    if (err instanceof RandomDrawError) return refusal(err.message);
    throw err;
  }
}

function runPick(values: Values): ToolResult {
  const text = str(values, 'items', '');
  if (text === '') return { outputs: [] };
  const picks = wholeNumber(values, 'pickCount', 'Picks', 1, 1, 10_000, '1 to 10,000');
  if ('message' in picks) return refusal(picks.message);
  const replace = bool(values, 'withReplacement');
  try {
    const items = readItemLines(text);
    const chosen = pickItems({ items, count: picks.value, replace });
    return {
      outputs: [
        {
          kind: 'code',
          label: `${chosen.length} pick${chosen.length === 1 ? '' : 's'}`,
          value: chosen.join('\n'),
          download: 'picks.txt',
        },
      ],
      stats: [
        ['Items in the list', String(items.length)],
        ['Picked', replace ? 'with replacement' : 'without replacement'],
        SOURCE_STAT,
      ],
    };
  } catch (err) {
    if (err instanceof RandomDrawError) return refusal(err.message);
    throw err;
  }
}

export default defineTool({
  id: 'random-number',
  autoRun: false,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'integer',
      options: [
        { value: 'integer', label: 'Integer' },
        { value: 'decimal', label: 'Decimal' },
        { value: 'dice', label: 'Roll dice' },
        { value: 'coin', label: 'Flip coins' },
        { value: 'lottery', label: 'Lottery draw' },
        { value: 'pick', label: 'Pick from a list' },
      ],
    },
    {
      name: 'notation',
      label: 'Notation',
      type: 'text',
      default: '2d6+3',
      help: `Dice notation such as 4d6kh3 or 1d20+1d4-2. Grammar: ${GRAMMAR_LINES.slice(0, 4).join('; ')}.`,
      visible: (v) => v.mode === 'dice',
    },
    {
      name: 'flips',
      label: 'Flips',
      type: 'number',
      default: 10,
      min: 1,
      max: 10000,
      help: 'How many coins to flip, from 1 to 10,000.',
      visible: (v) => v.mode === 'coin',
    },
    {
      name: 'poolSize',
      label: 'Pool size',
      type: 'number',
      default: 49,
      min: 2,
      max: 1000000,
      help: 'The numbers 1 up to this one are in the pool, from 2 to 1,000,000.',
      visible: (v) => v.mode === 'lottery',
    },
    {
      name: 'drawSize',
      label: 'Draw size',
      type: 'number',
      default: 6,
      min: 1,
      max: 10000,
      help: 'How many different numbers to draw, from 1 to 10,000 and never more than the pool holds.',
      visible: (v) => v.mode === 'lottery',
    },
    {
      name: 'items',
      label: 'Items',
      type: 'textarea',
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'One item per line. Blank lines are ignored. Up to 10,000 items of 200 characters.',
      visible: (v) => v.mode === 'pick',
    },
    {
      name: 'pickCount',
      label: 'Picks',
      type: 'number',
      default: 1,
      min: 1,
      max: 10000,
      help: 'How many items to pick, from 1 to 10,000.',
      visible: (v) => v.mode === 'pick',
    },
    {
      name: 'withReplacement',
      label: 'Pick with replacement',
      type: 'checkbox',
      default: false,
      help: 'Ticked, a line can come up more than once. Unticked, each line comes up at most once.',
      visible: (v) => v.mode === 'pick',
    },
    {
      name: 'min',
      label: 'Minimum',
      type: 'number',
      default: 1,
      visible: (v) => v.mode === 'integer' || v.mode === 'decimal',
    },
    {
      name: 'max',
      label: 'Maximum',
      type: 'number',
      default: 6,
      visible: (v) => v.mode === 'integer' || v.mode === 'decimal',
    },
    {
      name: 'count',
      label: 'How many',
      type: 'number',
      default: 1,
      min: 1,
      max: 10000,
      visible: (v) => v.mode === 'integer' || v.mode === 'decimal',
    },
    {
      name: 'places',
      label: 'Decimal places',
      type: 'number',
      default: 2,
      min: 0,
      max: 10,
      visible: (v) => v.mode === 'decimal',
    },
    {
      name: 'unique',
      label: 'No repeated values',
      type: 'checkbox',
      default: false,
      visible: (v) => v.mode === 'integer',
    },
    {
      name: 'source',
      label: 'Source of randomness',
      type: 'select',
      default: 'crypto',
      visible: (v) => v.mode === 'integer' || v.mode === 'decimal',
      options: [
        { value: 'crypto', label: 'Cryptographic (crypto.getRandomValues)' },
        { value: 'math', label: 'Non-cryptographic (Math.random) — test data only' },
      ],
    },
  ],
  examples: [
    { label: 'Dice roll', values: { mode: 'integer', min: 1, max: 6, count: 1 } },
    { label: 'Ten unique picks', values: { mode: 'integer', min: 1, max: 49, count: 6, unique: true } },
    { label: 'Decimal 0-1', values: { mode: 'decimal', min: 0, max: 1, places: 3, count: 1 } },
    { label: 'Roll 2d6+3', values: { mode: 'dice', notation: '2d6+3' } },
    { label: 'Roll 4d6, keep the best 3', values: { mode: 'dice', notation: '4d6kh3' } },
    { label: 'Flip ten coins', values: { mode: 'coin', flips: 10 } },
    { label: 'Lottery: 6 of 49', values: { mode: 'lottery', poolSize: 49, drawSize: 6 } },
    {
      label: 'Pick two names',
      values: { mode: 'pick', items: 'Ada\nBo\nCy\nDee', pickCount: 2, withReplacement: false },
    },
  ],
  run(values): ToolResult {
    // The four newer modes are handled first and never read the fields of the integer and decimal modes.
    const chosen = str(values, 'mode', 'integer');
    if (chosen === 'dice') return runDice(values);
    if (chosen === 'coin') return runCoin(values);
    if (chosen === 'lottery') return runLottery(values);
    if (chosen === 'pick') return runPick(values);

    const mode = str(values, 'mode', 'integer') === 'decimal' ? 'decimal' : 'integer';
    const min = num(values, 'min', 1);
    const max = num(values, 'max', 6);
    const count = Math.max(1, Math.floor(num(values, 'count', 1)));
    const places = num(values, 'places', 2);
    const unique = bool(values, 'unique');
    const source = (str(values, 'source', 'crypto') === 'math' ? 'math' : 'crypto') as RandomNumberSource;

    try {
      const result = generate({ mode, min, max, count, places, unique, source });
      const noun = mode === 'integer' ? 'random integer' : 'random decimal';
      return {
        outputs: [
          {
            kind: 'code',
            label: `${result.values.length} ${noun}${result.values.length === 1 ? '' : 's'}`,
            value: result.values.join('\n'),
            download: 'random-numbers.txt',
          },
        ],
        stats: [
          ['Range', `${result.min}–${result.max}`],
          ['Source', result.source === 'crypto' ? 'crypto.getRandomValues' : 'Math.random'],
        ],
      };
    } catch (err) {
      if (err instanceof RandomNumberError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      throw err;
    }
  },
});
