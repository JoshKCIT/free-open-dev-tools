/**
 * The worked examples of two W3C recommendations, extracted by a script from the recommendations as fetched on
 * 2026-10-02 (addresses and licence in UPSTREAM.md). Nothing here is a result of this tool or of libxml2: every string
 * is text the recommendations print. The examples are the specification's own, so a test that compares this tool's
 * output with them compares it with the specification (D-179).
 *
 * Canonical XML Version 1.0 section 3 prints every example twice, as display HTML and as an HTML comment holding the
 * exact characters; these are the comment's characters, with the characters that would end an HTML comment written
 * as `<!==` and `==>` in the recommendation restored to `<!--` and `-->`. A leading and a trailing line break
 * that only separate the comment's delimiters from its text are removed.
 */
/** Section 3.1, PIs, Comments, and Outside of Document Element: the input document (it declares a DOCTYPE). */
export const C14N_31_INPUT = "<?xml version=\"1.0\"?>\n\n<?xml-stylesheet   href=\"doc.xsl\"\n   type=\"text/xsl\"   ?>\n\n<!DOCTYPE doc SYSTEM \"doc.dtd\">\n\n<doc>Hello, world!<!-- Comment 1 --></doc>\n\n<?pi-without-data     ?>\n\n<!-- Comment 2 -->\n\n<!-- Comment 3 -->";

/** Section 3.1: the canonical form without comments. */
export const C14N_31_PLAIN = "<?xml-stylesheet href=\"doc.xsl\"\n   type=\"text/xsl\"   ?>\n<doc>Hello, world!</doc>\n<?pi-without-data?>";

/** Section 3.1: the canonical form with comments. */
export const C14N_31_COMMENTED = "<?xml-stylesheet href=\"doc.xsl\"\n   type=\"text/xsl\"   ?>\n<doc>Hello, world!<!-- Comment 1 --></doc>\n<?pi-without-data?>\n<!-- Comment 2 -->\n<!-- Comment 3 -->";

/** Section 3.2, Whitespace in Document Content: the input document. */
export const C14N_32_INPUT = "<doc>\n   <clean>   </clean>\n   <dirty>   A   B   </dirty>\n   <mixed>\n      A\n      <clean>   </clean>\n      B\n      <dirty>   A   B   </dirty>\n      C\n   </mixed>\n</doc>";

/** Section 3.2: the canonical form, which the recommendation says is identical to the input. */
export const C14N_32_OUTPUT = "<doc>\n   <clean>   </clean>\n   <dirty>   A   B   </dirty>\n   <mixed>\n      A\n      <clean>   </clean>\n      B\n      <dirty>   A   B   </dirty>\n      C\n   </mixed>\n</doc>";

/** Section 3.3, Start and End Tags: the input document (it declares a DOCTYPE with a default attribute). Not used by a test: the page refuses every DOCTYPE, so default attributes are never added. */
export const C14N_33_INPUT = "<!DOCTYPE doc [<!ATTLIST e9 attr CDATA \"default\">]>\n<doc>\n   <e1   />\n   <e2   ></e2>\n   <e3    name = \"elem3\"   id=\"elem3\"    />\n   <e4    name=\"elem4\"   id=\"elem4\"    ></e4>\n   <e5 a:attr=\"out\" b:attr=\"sorted\" attr2=\"all\" attr=\"I'm\"\n       xmlns:b=\"http://www.ietf.org\" \n       xmlns:a=\"http://www.w3.org\"\n       xmlns=\"http://example.org\"/>\n   <e6 xmlns=\"\" xmlns:a=\"http://www.w3.org\">\n       <e7 xmlns=\"http://www.ietf.org\">\n           <e8 xmlns=\"\" xmlns:a=\"http://www.w3.org\">\n               <e9 xmlns=\"\" xmlns:a=\"http://www.ietf.org\"/>\n           </e8>\n       </e7>\n   </e6>\n</doc>";

/** Section 3.3: the canonical form. */
export const C14N_33_OUTPUT = "<doc>\n   <e1></e1>\n   <e2></e2>\n   <e3 id=\"elem3\" name=\"elem3\"></e3>\n   <e4 id=\"elem4\" name=\"elem4\"></e4>\n   <e5 xmlns=\"http://example.org\" xmlns:a=\"http://www.w3.org\" xmlns:b=\"http://www.ietf.org\" attr=\"I'm\" attr2=\"all\" b:attr=\"sorted\" a:attr=\"out\"></e5> \n   <e6 xmlns:a=\"http://www.w3.org\">\n       <e7 xmlns=\"http://www.ietf.org\">\n           <e8 xmlns=\"\">\n               <e9 xmlns:a=\"http://www.ietf.org\" attr=\"default\"></e9>\n           </e8>\n       </e7>\n   </e6>\n</doc>";

/** Section 3.4, Character Modifications and Character References: the input document (it declares a DOCTYPE). */
export const C14N_34_INPUT = "<!DOCTYPE doc [\n<!ATTLIST normId id ID #IMPLIED>\n<!ATTLIST normNames attr NMTOKENS #IMPLIED>\n]>\n<doc>\n   <text>First line&#x0d;&#10;Second line</text>\n   <value>&#x32;</value>\n   <compute><![CDATA[value>\"0\" && value<\"10\" ?\"valid\":\"error\"]]></compute>\n   <compute expr='value>\"0\" &amp;&amp; value&lt;\"10\" ?\"valid\":\"error\"'>valid</compute>\n   <norm attr=' &apos;   &#x20;&#13;&#xa;&#9;   &apos; '/>\n   <normNames attr='   A   &#x20;&#13;&#xa;&#9;   B   '/>\n   <normId id=' &apos;   &#x20;&#13;&#xa;&#9;   &apos; '/>\n</doc>";

/** Section 3.4: the canonical form. */
export const C14N_34_OUTPUT = "<doc>\n   <text>First line&#xD;\nSecond line</text>\n   <value>2</value>\n   <compute>value&gt;\"0\" &amp;&amp; value&lt;\"10\" ?\"valid\":\"error\"</compute>\n   <compute expr=\"value>&quot;0&quot; &amp;&amp; value&lt;&quot;10&quot; ?&quot;valid&quot;:&quot;error&quot;\">valid</compute>\n   <norm attr=\" '    &#xD;&#xA;&#x9;   ' \"></norm>\n   <normNames attr=\"A &#xD;&#xA;&#x9; B\"></normNames>\n   <normId id=\"' &#xD;&#xA;&#x9; '\"></normId>\n</doc>";

/** Section 3.5, Entity References: the input document (an external entity world.txt). Left out of the tests by name: its external entity is never loaded. */
export const C14N_35_INPUT = "<!DOCTYPE doc [\n<!ATTLIST doc attrExtEnt ENTITY #IMPLIED>\n<!ENTITY ent1 \"Hello\">\n<!ENTITY ent2 SYSTEM \"world.txt\">\n<!ENTITY entExt SYSTEM \"earth.gif\" NDATA gif>\n<!NOTATION gif SYSTEM \"viewgif.exe\">\n]>\n<doc attrExtEnt=\"entExt\">\n   &ent1;, &ent2;!\n</doc>\n\n<!-- Let world.txt contain \"world\" (excluding the quotes) -->";

/** Section 3.5: the canonical form, which contains the text of the external file. */
export const C14N_35_OUTPUT = "<doc attrExtEnt=\"entExt\">\n   Hello, world!\n</doc>";

/** Section 3.6, UTF-8 Encoding: the input document. */
export const C14N_36_INPUT = "<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?>\n<doc>&#169;</doc>";

/** Section 3.6: the canonical form as printed. The recommendation writes the two bytes of the copyright sign as the text #xC2#xA9; its note says the content is the two octets C2 and A9, not that text. */
export const C14N_36_PRINTED = "<doc>#xC2#xA9</doc>";

/** Exclusive XML Canonicalization section 2.2 (General Problems with re-Enveloping), the first document, with the three-space margin of every printed line removed. */
export const EXC_INPUT = "<n0:local xmlns:n0=\"foo:bar\"\n          xmlns:n3=\"ftp://example.org\">\n   <n1:elem2 xmlns:n1=\"http://example.net\"\n             xml:lang=\"en\">\n       <n3:stuff xmlns:n3=\"ftp://example.org\"/>\n   </n1:elem2>\n</n0:local>";

/** The same section: what Canonical XML gives for the element n1:elem2 of that document, with the wrapped start tag joined back into one line. */
export const EXC_INCLUSIVE_RESULT = "<n1:elem2 xmlns:n0=\"foo:bar\" xmlns:n1=\"http://example.net\" xmlns:n3=\"ftp://example.org\" xml:lang=\"en\">\n       <n3:stuff></n3:stuff>\n   </n1:elem2>";

/** The same section: what Exclusive XML Canonicalization gives for the same element, with the wrapped start tag joined back into one line. */
export const EXC_EXCLUSIVE_RESULT = "<n1:elem2 xmlns:n1=\"http://example.net\" xml:lang=\"en\">\n       <n3:stuff xmlns:n3=\"ftp://example.org\"></n3:stuff>\n   </n1:elem2>";
