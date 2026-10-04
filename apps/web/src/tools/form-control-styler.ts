import {
  meta,
  styleControls,
  colourOrDefault,
  usesRadius,
  CONTROLS,
  PRESETS,
  FormControlError,
} from '@fodt/form-control-styler';
import { defineTool, bool, num, str, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

const DEFAULT_ACCENT = '#2563eb';
const DEFAULT_BACKGROUND = '#ffffff';
const CONTROL_OPTIONS = [...CONTROLS].map(([value, label]) => ({ value, label }));
const PRESET_OPTIONS = [...PRESETS].map(([value, label]) => ({ value, label }));

/** The corner radius field is shown only where it changes the result. */
const hasRadius = (v: Values) => usesRadius(str(v, 'control', 'button'), str(v, 'preset', 'rounded'));

export default defineTool({
  id: 'form-control-styler',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'control',
      label: 'Control',
      type: 'radio',
      default: 'button',
      options: CONTROL_OPTIONS,
      help: 'One family at a time. Each stays a native element.',
    },
    { name: 'preset', label: 'Preset', type: 'select', default: 'rounded', options: PRESET_OPTIONS },
    { name: 'accent', label: 'Accent', type: 'color', default: DEFAULT_ACCENT },
    {
      name: 'background',
      label: 'Background',
      type: 'color',
      default: DEFAULT_BACKGROUND,
      help: 'The colour behind the controls.',
    },
    {
      name: 'text',
      label: 'Label',
      type: 'text',
      default: 'Notify me',
      help: 'Shown beside the control, at most 40 characters. Empty becomes Option.',
    },
    { name: 'size', label: 'Size (px)', type: 'number', default: 20, min: 12, max: 32, step: 1 },
    {
      name: 'radius',
      label: 'Corner radius (px)',
      type: 'number',
      default: 6,
      min: 0,
      max: 24,
      step: 1,
      help: 'Not used by the plain and pill presets, the switch or the radio buttons.',
      visible: hasRadius,
    },
    { name: 'showDisabled', label: 'Show a disabled copy', type: 'checkbox', default: false },
  ],
  examples: [
    {
      label: 'Pill button',
      values: {
        control: 'button',
        preset: 'pill',
        accent: '#7c3aed',
        background: '#ffffff',
        text: 'Save changes',
        size: 18,
        showDisabled: true,
      },
    },
    {
      label: 'Switch',
      values: {
        control: 'switch',
        preset: 'rounded',
        accent: '#16a34a',
        background: '#ffffff',
        text: 'Email me about updates',
        size: 24,
        showDisabled: false,
      },
    },
    {
      label: 'Range slider',
      values: {
        control: 'range',
        preset: 'soft',
        accent: '#ea580c',
        background: '#fff7ed',
        text: 'Volume',
        size: 22,
        radius: 12,
        showDisabled: false,
      },
    },
  ],
  run(values, ctx): ToolResult {
    try {
      // The colour boxes take any typed text, so a bad one falls back to the default with a warning.
      const accent = colourOrDefault(str(values, 'accent', DEFAULT_ACCENT), DEFAULT_ACCENT, 'Accent');
      const background = colourOrDefault(
        str(values, 'background', DEFAULT_BACKGROUND),
        DEFAULT_BACKGROUND,
        'Background',
      );
      const result = styleControls({
        control: str(values, 'control', 'button'),
        preset: str(values, 'preset', 'rounded'),
        accent: accent.colour,
        background: background.colour,
        text: str(values, 'text', ''),
        size: num(values, 'size', 20),
        radius: num(values, 'radius', 6),
        showDisabled: bool(values, 'showDisabled', false),
      });
      const outputs: OutputBlock[] = [
        // The frame holds exactly the CSS shown below it; it has no scripts and may load only data addresses.
        { kind: 'sandboxed-html', label: 'Preview (a frame with no scripts)', html: result.html, copy: false },
        { kind: 'code', label: 'CSS to copy', value: result.css, language: 'css', download: 'controls.css' },
        { kind: 'code', label: 'Markup for this CSS', value: result.markup, language: 'html' },
      ];
      const warnings = [accent.warning, background.warning, ...result.warnings].filter((w): w is string => w !== null);
      return { outputs, warnings: warnings.length > 0 ? warnings : undefined };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (err instanceof FormControlError) return { outputs: [], errors: [{ message: err.message }] };
      return {
        outputs: [],
        errors: [{ message: 'The controls could not be styled. Reset the fields and try again.' }],
      };
    }
  },
});
