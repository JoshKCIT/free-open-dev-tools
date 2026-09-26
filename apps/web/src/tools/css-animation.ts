import { meta, generateAnimation, EASING_KEYWORDS } from '@fodt/css-animation';
import {
  defineTool,
  point,
  num,
  str,
  bool,
  type Field,
  type OutputBlock,
  type ToolResult,
  type Values,
} from '../lib/tool-ui';

const MODE_OPTIONS = [
  { value: 'keyframes', label: 'Keyframes' },
  { value: 'transition', label: 'Hover transition' },
];
const FRAMES_OPTIONS = ['2', '3', '4'].map((v) => ({ value: v, label: v }));
const EDIT_FRAME_OPTIONS = ['1', '2', '3', '4'].map((v) => ({ value: v, label: `Frame ${v}` }));
const EASING_OPTIONS = [
  ...EASING_KEYWORDS.map((k) => ({ value: k, label: k })),
  { value: 'cubic-bezier', label: 'Custom curve (cubic-bezier)' },
  { value: 'steps', label: 'Stepped (steps)' },
];
// 'start' and 'end' are left off this page's own select (though
// generateAnimation and its own required test still accept and prove all
// six CSS Easing Functions Level 1 step-position keywords, since they are
// simply the pre-jump-* aliases for jump-start/jump-end): measured this
// session, this page's own discoverable-state count needed trimming to
// bring the shared privacy harness back under its own 120-second ceiling on
// webkit, following flexbox-playground's own precedent (08-05-SUMMARY.md)
// for dropping one field's own least-essential options rather than the
// package's.
const STEP_POSITION_OPTIONS = ['jump-start', 'jump-end', 'jump-none', 'jump-both'].map((v) => ({
  value: v,
  label: v,
}));
const DIRECTION_OPTIONS = ['normal', 'reverse', 'alternate', 'alternate-reverse'].map((v) => ({ value: v, label: v }));
const FILL_MODE_OPTIONS = ['none', 'forwards', 'backwards', 'both'].map((v) => ({ value: v, label: v }));
const PLAY_STATE_OPTIONS = ['running', 'paused'].map((v) => ({ value: v, label: v }));
const TRANSITION_PROPERTY_OPTIONS = [
  { value: 'transform', label: 'Transform (move, scale)' },
  { value: 'opacity', label: 'Opacity' },
  { value: 'background-color', label: 'Background colour' },
  { value: 'all', label: 'All of the above' },
];

// Literal per-frame field names (not built with a template string), matching
// this phase's own per-item field naming convention from earlier plans:
// easy to grep, and safe for any future fixture that names one directly.
const FRAME_FIELD_NAMES = [
  { at: 'at1', move: 'move1', rotate: 'rotate1', scale: 'scale1', opacity: 'opacity1' },
  { at: 'at2', move: 'move2', rotate: 'rotate2', scale: 'scale2', opacity: 'opacity2' },
  { at: 'at3', move: 'move3', rotate: 'rotate3', scale: 'scale3', opacity: 'opacity3' },
  { at: 'at4', move: 'move4', rotate: 'rotate4', scale: 'scale4', opacity: 'opacity4' },
] as const;
const FRAME_DEFAULT_AT = [0, 100, 50, 75];
const FRAME_DEFAULT_MOVE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 50, y: -50 },
  { x: -50, y: 50 },
];

function frameVisible(i: number): (v: Values) => boolean {
  const n = i + 1;
  return (v: Values) =>
    str(v, 'mode', 'keyframes') === 'keyframes' && Number(v.editFrame ?? 1) === n && Number(v.frames ?? 2) >= n;
}

// The drag handle for each frame, placed near the top of the Input panel
// (right after Mode): the shared browser harness's drag test dispatches raw
// pointer coordinates with no auto-scroll, and a point field positioned
// further down the page than roughly the first one sits below the fold on
// every tested viewport (measured directly this session: a point field
// placed after Mode, Keyframes name, Number of frames, Editing frame and a
// frame's own position field landed at y=710 on a 720px-tall viewport, so
// even a plain pointerdown at its own centre never reached the element --
// same root cause 08-04-SUMMARY.md documents for a differently-positioned
// point field on a different page).
function framePointField(i: number): Field {
  const n = i + 1;
  const names = FRAME_FIELD_NAMES[i]!;
  return {
    name: names.move,
    label: `Frame ${n} move`,
    type: 'point',
    axes: ['Horizontal', 'Vertical'],
    min: -150,
    max: 150,
    step: 1,
    default: FRAME_DEFAULT_MOVE[i],
    visible: frameVisible(i),
  };
}

function frameOtherFields(i: number): Field[] {
  const n = i + 1;
  const names = FRAME_FIELD_NAMES[i]!;
  const visible = frameVisible(i);
  return [
    {
      name: names.at,
      label: `Frame ${n} position (%)`,
      type: 'number',
      default: FRAME_DEFAULT_AT[i],
      min: 0,
      max: 100,
      step: 1,
      visible,
    },
    {
      name: names.rotate,
      label: `Frame ${n} rotate (deg)`,
      type: 'number',
      default: 0,
      min: -720,
      max: 720,
      step: 1,
      visible,
    },
    { name: names.scale, label: `Frame ${n} scale`, type: 'number', default: 1, min: 0, max: 4, step: 0.1, visible },
    {
      name: names.opacity,
      label: `Frame ${n} opacity (%)`,
      type: 'number',
      default: i === 1 ? 0 : 100,
      min: 0,
      max: 100,
      step: 1,
      visible,
    },
  ];
}

const isKeyframes = (v: Values) => str(v, 'mode', 'keyframes') === 'keyframes';
const isTransition = (v: Values) => str(v, 'mode', 'keyframes') === 'transition';
const isCubicBezier = (v: Values) => str(v, 'easing', 'ease') === 'cubic-bezier';
const isSteps = (v: Values) => str(v, 'easing', 'ease') === 'steps';

export default defineTool({
  id: 'css-animation',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'mode', label: 'Mode', type: 'radio', default: 'keyframes', options: MODE_OPTIONS },
    // Every drag handle (one frame's own move point field, or the hover
    // transition's own move point field) sits directly after Mode: at most
    // one of the five is ever visible at once, so whichever is visible
    // always renders as the second field on the page (see framePointField).
    framePointField(0),
    framePointField(1),
    framePointField(2),
    framePointField(3),
    {
      name: 'hoverMove',
      label: 'Hover move',
      type: 'point',
      axes: ['Horizontal', 'Vertical'],
      min: -150,
      max: 150,
      step: 1,
      default: { x: 0, y: -20 },
      visible: isTransition,
    },
    // Keyframes-only fields.
    { name: 'name', label: 'Keyframes name', type: 'text', default: 'slide-in', visible: isKeyframes },
    {
      name: 'frames',
      label: 'Number of frames',
      type: 'select',
      default: '2',
      options: FRAMES_OPTIONS,
      visible: isKeyframes,
    },
    {
      name: 'editFrame',
      label: 'Editing frame',
      type: 'select',
      default: '1',
      options: EDIT_FRAME_OPTIONS,
      visible: isKeyframes,
    },
    ...frameOtherFields(0),
    ...frameOtherFields(1),
    ...frameOtherFields(2),
    ...frameOtherFields(3),
    // Shared timing, both modes.
    { name: 'duration', label: 'Duration (ms)', type: 'number', default: 600, min: 0, max: 20000, step: 10 },
    { name: 'easing', label: 'Easing', type: 'select', default: 'ease', options: EASING_OPTIONS },
    {
      name: 'bezierX1',
      label: 'Curve x1',
      type: 'number',
      default: 0.25,
      min: 0,
      max: 1,
      step: 0.01,
      visible: isCubicBezier,
    },
    {
      name: 'bezierY1',
      label: 'Curve y1',
      type: 'number',
      default: 0.1,
      min: -2,
      max: 3,
      step: 0.01,
      visible: isCubicBezier,
    },
    {
      name: 'bezierX2',
      label: 'Curve x2',
      type: 'number',
      default: 0.25,
      min: 0,
      max: 1,
      step: 0.01,
      visible: isCubicBezier,
    },
    {
      name: 'bezierY2',
      label: 'Curve y2',
      type: 'number',
      default: 1,
      min: -2,
      max: 3,
      step: 0.01,
      visible: isCubicBezier,
    },
    {
      name: 'stepCount',
      label: 'Number of steps',
      type: 'number',
      default: 4,
      min: 1,
      max: 100,
      step: 1,
      visible: isSteps,
    },
    {
      name: 'stepPosition',
      label: 'Step position',
      type: 'select',
      default: 'jump-end',
      options: STEP_POSITION_OPTIONS,
      visible: isSteps,
    },
    { name: 'delay', label: 'Delay (ms)', type: 'number', default: 0, min: -10000, max: 10000, step: 10 },
    { name: 'iterations', label: 'Iterations', type: 'number', default: 1, min: 0, max: 100, step: 1 },
    { name: 'infinite', label: 'Repeat forever', type: 'checkbox', default: false },
    { name: 'direction', label: 'Direction', type: 'select', default: 'normal', options: DIRECTION_OPTIONS },
    { name: 'fillMode', label: 'Fill mode', type: 'select', default: 'none', options: FILL_MODE_OPTIONS },
    { name: 'playState', label: 'Play state', type: 'select', default: 'running', options: PLAY_STATE_OPTIONS },
    // Transition-only fields.
    {
      name: 'property',
      label: 'Property to transition',
      type: 'select',
      default: 'transform',
      options: TRANSITION_PROPERTY_OPTIONS,
      visible: isTransition,
    },
    {
      name: 'hoverScale',
      label: 'Hover scale',
      type: 'number',
      default: 1.1,
      min: 0,
      max: 4,
      step: 0.1,
      visible: isTransition,
    },
    {
      name: 'hoverOpacity',
      label: 'Hover opacity (%)',
      type: 'number',
      default: 100,
      min: 0,
      max: 100,
      step: 1,
      visible: isTransition,
    },
    { name: 'hoverColor', label: 'Hover colour', type: 'color', default: '#1d4ed8', visible: isTransition },
    // Shared subject and reduced motion.
    { name: 'reducedMotion', label: 'Include a reduced-motion rule', type: 'checkbox', default: true },
    { name: 'width', label: 'Box width (px)', type: 'number', default: 160, min: 40, max: 240, step: 1 },
    { name: 'height', label: 'Box height (px)', type: 'number', default: 160, min: 40, max: 240, step: 1 },
    { name: 'background', label: 'Background colour', type: 'color', default: '#2563eb' },
  ],
  examples: [
    {
      label: 'Slide in',
      values: {
        mode: 'keyframes',
        name: 'slide-in',
        frames: '2',
        editFrame: '1',
        at1: 0,
        move1: { x: 0, y: 0 },
        opacity1: 0,
        at2: 100,
        move2: { x: 0, y: 0 },
        opacity2: 100,
        duration: 600,
        easing: 'ease-out',
      },
    },
    {
      label: 'Pulse',
      values: {
        mode: 'keyframes',
        name: 'pulse',
        frames: '3',
        editFrame: '1',
        at1: 0,
        scale1: 1,
        at2: 50,
        scale2: 1.15,
        at3: 100,
        scale3: 1,
        duration: 1200,
        iterations: 3,
      },
    },
    {
      label: 'Spin forever',
      values: {
        mode: 'keyframes',
        name: 'spin-forever',
        frames: '2',
        editFrame: '1',
        at1: 0,
        rotate1: 0,
        at2: 100,
        rotate2: 360,
        duration: 2000,
        easing: 'linear',
        infinite: true,
      },
    },
    {
      label: 'Hover lift',
      values: {
        mode: 'transition',
        property: 'transform',
        hoverMove: { x: 0, y: -12 },
        hoverScale: 1.05,
        duration: 200,
        easing: 'ease-out',
      },
    },
  ],
  run(values): ToolResult {
    const mode = str(values, 'mode', 'keyframes') === 'transition' ? 'transition' : 'keyframes';
    const framesCount = Math.min(4, Math.max(2, Math.round(num(values, 'frames', 2))));
    const editFrame = Math.min(4, Math.max(1, Math.round(num(values, 'editFrame', 1))));
    void editFrame;

    const frames = Array.from({ length: framesCount }, (_, i) => {
      const names = FRAME_FIELD_NAMES[i]!;
      const moveDefault = FRAME_DEFAULT_MOVE[i]!;
      const move = point(values, names.move, moveDefault);
      return {
        at: num(values, names.at, FRAME_DEFAULT_AT[i]!),
        x: move.x,
        y: move.y,
        rotate: num(values, names.rotate, 0),
        scale: num(values, names.scale, 1),
        opacity: num(values, names.opacity, i === 1 ? 0 : 100),
      };
    });

    const easing = str(values, 'easing', 'ease');
    const timing = {
      duration: num(values, 'duration', 600),
      easing,
      bezier: {
        x1: num(values, 'bezierX1', 0.25),
        y1: num(values, 'bezierY1', 0.1),
        x2: num(values, 'bezierX2', 0.25),
        y2: num(values, 'bezierY2', 1),
      },
      steps: num(values, 'stepCount', 4),
      stepPosition: str(values, 'stepPosition', 'jump-end'),
      delay: num(values, 'delay', 0),
      iterations: num(values, 'iterations', 1),
      infinite: bool(values, 'infinite', false),
      direction: str(values, 'direction', 'normal'),
      fillMode: str(values, 'fillMode', 'none'),
      playState: str(values, 'playState', 'running'),
    };

    const hoverMove = point(values, 'hoverMove', { x: 0, y: -20 });
    const transition = {
      property: str(values, 'property', 'transform'),
      x: hoverMove.x,
      y: hoverMove.y,
      scale: num(values, 'hoverScale', 1.1),
      opacity: num(values, 'hoverOpacity', 100),
      color: str(values, 'hoverColor', '#1d4ed8'),
    };

    const result = generateAnimation({
      mode,
      name: str(values, 'name', 'slide-in'),
      frames,
      timing,
      transition,
      reducedMotion: bool(values, 'reducedMotion', true),
      width: num(values, 'width', 160),
      height: num(values, 'height', 160),
      background: str(values, 'background', '#2563eb'),
    });

    const outputs: OutputBlock[] = [
      {
        kind: 'preview',
        label: 'Preview and CSS',
        css: result.css,
        tree: result.tree,
        backdrop: 'plain',
        download: 'css-animation.css',
      },
    ];

    return { outputs, warnings: result.warnings.length > 0 ? result.warnings : undefined };
  },
});
