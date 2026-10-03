/**
 * Diagram texts the tests and the browser spec use: one small sample of each of the 22 diagram types Mermaid 11.17.2
 * draws (the flowchart and the pie also carry accTitle and accDescr lines), and 19 hostile diagrams. `{PORT}` in a
 * hostile text stands for the port of a local recording server; the unit tests only read the text.
 */
export const SAMPLES: Readonly<Record<string, string>> = {
  flowchart:
    'flowchart TD\n  accTitle: Order flow\n  accDescr: How an order moves from the start to the end\n  A[Start] --> B{Is it?}\n  B -->|Yes| C[OK]\n  B -->|No| D[End]',
  sequence: 'sequenceDiagram\n  title Greeting\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi',
  class: 'classDiagram\n  Animal <|-- Duck\n  Animal : +int age',
  state: 'stateDiagram-v2\n  [*] --> Still\n  Still --> Moving',
  er: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places',
  gantt: 'gantt\n  title A\n  dateFormat YYYY-MM-DD\n  section S\n  Task :a1, 2024-01-01, 30d',
  pie: 'pie title Pets\n  accTitle: Pet share\n  accDescr: Dogs and cats compared\n  "Dogs" : 386\n  "Cats" : 85',
  journey: 'journey\n  title My day\n  section Work\n    Make tea: 5: Me',
  gitGraph: 'gitGraph\n  commit\n  branch dev\n  commit\n  checkout main\n  merge dev',
  mindmap: 'mindmap\n  root((mind))\n    Origins\n    Tools',
  timeline: 'timeline\n  title History\n  2002 : LinkedIn\n  2004 : Facebook',
  quadrant: 'quadrantChart\n  title Reach\n  x-axis Low --> High\n  y-axis Low --> High\n  quadrant-1 We\n  A: [0.3, 0.6]',
  requirement:
    'requirementDiagram\n  requirement test_req {\n    id: 1\n    text: the test text.\n    risk: high\n    verifymethod: test\n  }\n  element test_entity {\n    type: simulation\n  }\n  test_entity - satisfies -> test_req',
  c4: 'C4Context\n  title System\n  Person(a, "User")\n  System(b, "Sys")\n  Rel(a, b, "Uses")',
  sankey: 'sankey-beta\n\nA,B,10\nB,C,5',
  xychart: 'xychart-beta\n  title "Sales"\n  x-axis [jan, feb]\n  y-axis "Rev" 0 --> 100\n  bar [10, 50]\n  line [10, 50]',
  block: 'block-beta\n  columns 2\n  a b',
  packet: 'packet-beta\n  0-15: "Source Port"\n  16-31: "Destination Port"',
  kanban: 'kanban\n  Todo\n    id1[Task 1]',
  architecture:
    'architecture-beta\n  group api(cloud)[API]\n  service db(database)[Database] in api\n  service s(server)[Server] in api\n  db:L -- R:s',
  radar: 'radar-beta\n  axis a, b, c\n  curve x{1,2,3}',
  treemap: 'treemap-beta\n"Root"\n    "Leaf": 10',
};

/** The hostile diagrams. Each is refused before drawing, refused after drawing, or drawn without a single request. */
export const ATTACKS: Readonly<Record<string, string>> = {
  img_in_label: `flowchart LR\n  A["<img src='http://127.0.0.1:{PORT}/img-label.png'>"]`,
  style_fill_url: `flowchart LR\n  A --> B\n  style A fill:url(http://127.0.0.1:{PORT}/x.svg#a),background:url(http://127.0.0.1:{PORT}/bg.png)`,
  classdef_url: `flowchart LR\n  A --> B\n  classDef x fill:url(http://127.0.0.1:{PORT}/cd.png),stroke:red\n  class A x`,
  init_themeCSS: `%%{init: {"themeCSS": "@import url(http://127.0.0.1:{PORT}/css-import.css); .node{background:url(http://127.0.0.1:{PORT}/css-bg.png)}"}}%%\nflowchart LR\n  A-->B`,
  init_fontFamily: `%%{init: {"fontFamily": "x; background:url(http://127.0.0.1:{PORT}/ff.png)"}}%%\nflowchart LR\n  A-->B`,
  frontmatter_themeCSS: `---\nconfig:\n  themeCSS: "@import url(http://127.0.0.1:{PORT}/fm.css);"\n---\nflowchart LR\n  A-->B`,
  click_href: `flowchart LR\n  A-->B\n  click A href "http://127.0.0.1:{PORT}/click" _blank`,
  img_shape: `flowchart LR\n  A@{ img: "http://127.0.0.1:{PORT}/node-img.png", label: "x", pos: "t", w: 60, h: 60, constraint: "on" }`,
  icon_shape: `flowchart LR\n  A@{ icon: "logos:aws", form: "square", label: "x" }`,
  markdown_img: 'flowchart LR\n  A["`![img](http://127.0.0.1:{PORT}/md.png)`"]',
  seq_img: `sequenceDiagram\n  participant A as <img src="http://127.0.0.1:{PORT}/seq.png">\n  A->>A: x`,
  seq_link: `sequenceDiagram\n  participant A\n  link A: Dash @ http://127.0.0.1:{PORT}/link\n  A->>A: x`,
  katex: 'flowchart LR\n  A["$$x^2 + a/b$$"]',
  arch_icon: `architecture-beta\n  service s(logos:aws)[S]\n  service t(server)[T]\n  s:R -- L:t`,
  font_awesome: 'flowchart LR\n  A["fa:fa-car Car"] --> B["fab:fa-github G"]',
  a_href_label: `flowchart LR\n  A["<a href='http://127.0.0.1:{PORT}/a'>x</a>"]`,
  script_label: 'flowchart LR\n  A["<script>window.top.x=1</script>x"]',
  onerror: `flowchart LR\n  A["<img src=x onerror=alert(1)>"]`,
  svg_foreign: `flowchart LR\n  A["<svg><image href='http://127.0.0.1:{PORT}/svgimg.png'></svg>"]`,
};
