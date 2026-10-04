import { meta, locationLegendRows } from '@fodt/keyboard-event-viewer';
import { ensureKeyCapture } from '../lib/key-capture';
import { defineTool, bool, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'keyboard-event-viewer',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'showKeydown', label: 'keydown', type: 'checkbox', default: true },
    { name: 'showKeypress', label: 'keypress (legacy)', type: 'checkbox', default: true },
    { name: 'showKeyup', label: 'keyup', type: 'checkbox', default: true },
    { name: 'showComposition', label: 'Composition events', type: 'checkbox', default: true },
    {
      name: 'preventOther',
      label: 'Prevent the browser default for keys other than Tab and Escape',
      type: 'checkbox',
      default: false,
      help: 'Stops keys such as Space or F5 from scrolling or reloading while you look at them. Tab and Escape always keep working, so you can leave the capture box, and the keys of an input method (the key Process, key code 229, or any key pressed while composing) are never prevented either. Preventing a key down also stops the browser from sending the legacy key press for it. The defaultPrevented column shows what the browser reported before this page acted, and says when this page then prevented the default.',
    },
  ],
  examples: [
    {
      label: 'Key down only',
      values: { showKeydown: true, showKeypress: false, showKeyup: false, showComposition: false },
    },
    { label: 'Prevent default actions', values: { preventOther: true } },
  ],
  run(values): ToolResult {
    const status = ensureKeyCapture({
      show: {
        keydown: bool(values, 'showKeydown', true),
        keypress: bool(values, 'showKeypress', true),
        keyup: bool(values, 'showKeyup', true),
        composition: bool(values, 'showComposition', true),
      },
      preventOther: bool(values, 'preventOther', false),
    });
    return {
      outputs: [
        {
          kind: 'note',
          tone: 'info',
          value:
            status === 'ready'
              ? 'Click in the key capture box above and press keys. What you press is shown only in this page and is cleared when you leave it.'
              : 'The key capture box could not be shown on this page.',
        },
        {
          kind: 'table',
          label: 'Location values (UI Events)',
          table: { headers: ['Value', 'Name', 'Constant'], rows: locationLegendRows(), mono: [2] },
        },
      ],
    };
  },
});
