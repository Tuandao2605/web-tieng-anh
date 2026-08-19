export type SeparatorMode =
  | 'auto'
  | 'tab'
  | 'pipe'
  | 'semicolon'
  | 'comma'
  | 'parenthesis';

const separators: Record<Exclude<SeparatorMode, 'auto' | 'parenthesis'>, string> = {
  tab: '\t',
  pipe: '|',
  semicolon: ';',
  comma: ',',
};

const splitAtFirst = (line: string, separator: string): [string, string] | null => {
  const index = line.indexOf(separator);
  if (index === -1) return null;
  return [line.slice(0, index), line.slice(index + separator.length)];
};

const splitParenthesizedDefinition = (line: string): [string, string] | null => {
  const openingIndex = line.indexOf('(');
  const closingIndex = line.lastIndexOf(')');
  if (openingIndex <= 0 || closingIndex <= openingIndex) return null;

  const trailingText = line.slice(closingIndex + 1).trim();
  const definition = [line.slice(openingIndex + 1, closingIndex), trailingText]
    .filter(Boolean)
    .join(' ');
  return [line.slice(0, openingIndex), definition];
};

/**
 * Splits common vocabulary exports so only the English word/phrase is placed
 * on the front and all metadata plus the meaning remain on the back:
 *   Chronic | (adj) [B2] Mạn tính, kéo dài
 */
const splitBeforeVocabularyMetadata = (line: string): [string, string] | null => {
  const match = line.match(
    /^(.+?)\s+((?:\([^()\r\n]+\)\s*)?(?:\[[^\]\r\n]+\]\s*)+.+)$/u,
  );
  return match ? [match[1], match[2]] : null;
};

const splitOnColumnSpacing = (line: string): [string, string] | null => {
  const match = line.match(/^(.+?\S)[ \u00a0]{2,}(\S.*)$/u);
  return match ? [match[1], match[2]] : null;
};

export function splitBulkCardLine(
  line: string,
  mode: SeparatorMode,
): [string, string] | null {
  if (mode === 'parenthesis') return splitParenthesizedDefinition(line);
  if (mode !== 'auto') return splitAtFirst(line, separators[mode]);

  // A real spreadsheet tab is the strongest signal of two separate columns.
  const tabSeparated = splitAtFirst(line, '\t');
  if (tabSeparated) return tabSeparated;

  // Detect dictionary-style metadata before punctuation because definitions
  // commonly contain commas, semicolons or other punctuation.
  const metadataSeparated = splitBeforeVocabularyMetadata(line);
  if (metadataSeparated) return metadataSeparated;

  for (const separator of ['|', ';']) {
    const separated = splitAtFirst(line, separator);
    if (separated) return separated;
  }

  // Text copied from aligned documents may replace a tab with 2+ spaces.
  return splitOnColumnSpacing(line);
}
