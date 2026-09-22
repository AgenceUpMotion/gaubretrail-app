const windows1252 = new Map([
  ['€', 0x80], ['‚', 0x82], ['ƒ', 0x83], ['„', 0x84], ['…', 0x85], ['†', 0x86], ['‡', 0x87], ['ˆ', 0x88], ['‰', 0x89], ['Š', 0x8a], ['‹', 0x8b], ['Œ', 0x8c], ['Ž', 0x8e],
  ['‘', 0x91], ['’', 0x92], ['“', 0x93], ['”', 0x94], ['•', 0x95], ['–', 0x96], ['—', 0x97], ['˜', 0x98], ['™', 0x99], ['š', 0x9a], ['›', 0x9b], ['œ', 0x9c], ['ž', 0x9e], ['Ÿ', 0x9f],
]);
const utf8 = new TextDecoder('utf-8', { fatal: true });

const mojibakeScore = value => (value.match(/Ã.|Â.|â(?:€|™|œ|ž|˜|‚|„|†|‡|…)/g) || []).length;

function decodeWindows1252AsUtf8(value) {
  const bytes = [];
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code <= 0xff) bytes.push(code);
    else if (windows1252.has(char)) bytes.push(windows1252.get(char));
    else return null;
  }
  try { return utf8.decode(Uint8Array.from(bytes)); }
  catch { return null; }
}

export function repairMojibake(value) {
  let repaired = value;
  // Some old imports were decoded twice, so repair at most two passes.
  for (let pass = 0; pass < 2 && mojibakeScore(repaired); pass++) {
    const candidate = decodeWindows1252AsUtf8(repaired);
    if (!candidate || mojibakeScore(candidate) >= mojibakeScore(repaired)) break;
    repaired = candidate;
  }
  return repaired;
}

export function repairStateEncoding(state) {
  let repairedStrings = 0;
  const visit = value => {
    if (typeof value === 'string') {
      const repaired = repairMojibake(value);
      if (repaired !== value) repairedStrings++;
      return repaired;
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    return value;
  };
  return { state: visit(state), repairedStrings };
}
