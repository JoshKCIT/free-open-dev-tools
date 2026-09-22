import { meta, describe, split, rangeToCidrs, summarise, contains, randomInBlock, IpError } from '@fodt/ip-subnet';
import { defineTool, str, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'ip-subnet',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'What to do',
      type: 'radio',
      default: 'describe',
      options: [
        { value: 'describe', label: 'Describe a block' },
        { value: 'split', label: 'Split into subnets' },
        { value: 'range', label: 'Range to CIDR' },
        { value: 'summarise', label: 'Summarise blocks' },
        { value: 'contains', label: 'Is an address inside?' },
      ],
    },
    {
      name: 'cidr',
      label: 'Address or CIDR block',
      type: 'text',
      mono: true,
      default: '192.168.1.130/26',
      placeholder: '10.0.0.0/8, 192.168.1.0/255.255.255.0 or 2001:db8::/32',
      visible: (v) => v.mode === 'describe' || v.mode === 'split' || v.mode === 'contains',
    },
    {
      name: 'newPrefix',
      label: 'Split into blocks of prefix length',
      type: 'number',
      default: 28,
      min: 0,
      max: 128,
      visible: (v) => v.mode === 'split',
    },
    {
      name: 'start',
      label: 'First address',
      type: 'text',
      mono: true,
      default: '192.168.1.1',
      visible: (v) => v.mode === 'range',
    },
    {
      name: 'end',
      label: 'Last address',
      type: 'text',
      mono: true,
      default: '192.168.1.200',
      visible: (v) => v.mode === 'range',
    },
    {
      name: 'blocks',
      label: 'Blocks, one per line',
      type: 'textarea',
      rows: 6,
      mono: true,
      default: '192.168.0.0/25\n192.168.0.128/25\n192.168.2.0/24',
      visible: (v) => v.mode === 'summarise',
    },
    {
      name: 'address',
      label: 'Address to check',
      type: 'text',
      mono: true,
      default: '192.168.1.150',
      visible: (v) => v.mode === 'contains',
    },
    {
      name: 'randomCount',
      label: 'Also generate this many random addresses in the block',
      type: 'number',
      default: 0,
      min: 0,
      max: 200,
      visible: (v) => v.mode === 'describe',
    },
  ],
  examples: [
    { label: 'IPv4 /26', values: { mode: 'describe', cidr: '192.168.1.130/26' } },
    { label: 'IPv6 /64', values: { mode: 'describe', cidr: '2001:db8:1:2::abcd/64' } },
    { label: 'Point-to-point /31', values: { mode: 'describe', cidr: '10.0.0.0/31' } },
    { label: 'Split a /24', values: { mode: 'split', cidr: '192.168.1.0/24', newPrefix: 26 } },
  ],
  run(values): ToolResult {
    try {
      const mode = str(values, 'mode', 'describe');

      if (mode === 'describe') {
        const cidr = str(values, 'cidr');
        if (!cidr.trim()) return { outputs: [] };
        const r = describe(cidr);

        const pairs: [string, string][] = [
          ['Network', `${r.network}/${r.prefix}`],
          ['Netmask', r.mask],
          ['Wildcard mask', r.wildcard],
          ['First address', r.firstAddress],
          ['Last address', r.lastAddress],
        ];
        if (r.broadcast) pairs.push(['Broadcast', r.broadcast]);
        if (r.firstHost) pairs.push(['First usable host', r.firstHost]);
        if (r.lastHost) pairs.push(['Last usable host', r.lastHost]);
        pairs.push(['Total addresses', r.totalAddresses]);
        pairs.push(['Usable hosts', r.usableHosts]);
        if (r.expanded) pairs.push(['Expanded', r.expanded]);
        pairs.push(['Reverse DNS name', r.arpa]);

        const outputs: OutputBlock[] = [{ kind: 'keyvalue', label: `IPv${r.version} block`, pairs }];

        if (r.addressIsNotNetwork) {
          outputs.unshift({
            kind: 'note',
            tone: 'info',
            value: `${r.inputAddress} is a host inside this block, not the network address. The network address is ${r.network}.`,
          });
        }
        if (r.version === 4 && r.prefix === 31) {
          outputs.push({
            kind: 'note',
            tone: 'info',
            value:
              'A /31 is a point-to-point link under RFC 3021. It has no broadcast address, and both of its addresses are usable, so the usual subtract-two rule does not apply.',
          });
        }
        outputs.push({ kind: 'list', label: 'What kind of address this is', items: r.scope });
        outputs.push({
          kind: 'keyvalue',
          label: 'Binary',
          pairs: [
            ['Network', r.binaryNetwork],
            ['Mask', r.binaryMask],
          ],
        });

        const count = num(values, 'randomCount', 0);
        if (count > 0) {
          outputs.push({
            kind: 'code',
            label: `${count} random address${count === 1 ? '' : 'es'} in this block`,
            value: randomInBlock(cidr, count).join('\n'),
          });
        }
        return { outputs };
      }

      if (mode === 'split') {
        const cidr = str(values, 'cidr');
        if (!cidr.trim()) return { outputs: [] };
        const r = split(cidr, num(values, 'newPrefix', 28));
        return {
          outputs: [
            {
              kind: 'table',
              label: `${r.total} subnet${r.total === '1' ? '' : 's'}${r.truncated ? `, showing the first ${r.subnets.length}` : ''}`,
              table: {
                headers: ['CIDR', 'Network', 'Last address', 'Addresses'],
                rows: r.subnets.map((s) => [s.cidr, s.network, s.lastAddress, s.size]),
                mono: [0, 1, 2],
              },
            },
          ],
          warnings: r.truncated
            ? [`This split produces ${r.total} subnets. Only the first ${r.subnets.length} are listed.`]
            : undefined,
        };
      }

      if (mode === 'range') {
        const cidrs = rangeToCidrs(str(values, 'start'), str(values, 'end'));
        return {
          outputs: [
            {
              kind: 'code',
              label: `${cidrs.length} block${cidrs.length === 1 ? '' : 's'} cover this range exactly`,
              value: cidrs.join('\n'),
            },
          ],
        };
      }

      if (mode === 'summarise') {
        const list = str(values, 'blocks')
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        if (list.length === 0) return { outputs: [] };
        const result = summarise(list);
        return {
          outputs: [
            { kind: 'code', label: `${list.length} blocks reduce to ${result.length}`, value: result.join('\n') },
          ],
        };
      }

      const cidr = str(values, 'cidr');
      const address = str(values, 'address');
      if (!cidr.trim() || !address.trim()) return { outputs: [] };
      const inside = contains(cidr, address);
      return {
        outputs: [
          {
            kind: 'note',
            tone: inside ? 'success' : 'warn',
            value: inside ? `${address} is inside ${cidr}.` : `${address} is not inside ${cidr}.`,
          },
        ],
      };
    } catch (err) {
      if (err instanceof IpError) return { outputs: [], errors: [{ message: err.message }] };
      throw err;
    }
  },
});
