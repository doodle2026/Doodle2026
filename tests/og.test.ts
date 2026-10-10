import { describe, test, expect } from 'vitest';
import { countLabel, ogImagePath, ogTitle } from '../src/lib/og';
import { textLength } from '../src/lib/validate';

describe('OG image text rules (design §14.4)', () => {
  test('short titles unchanged, 68 px', () => {
    expect(ogTitle('Teammøde om Q4')).toEqual({ text: 'Teammøde om Q4', long: false });
  });
  test('> 40 graphemes → long (56 px)', () => {
    expect(ogTitle('a'.repeat(41)).long).toBe(true);
    expect(ogTitle('a'.repeat(40)).long).toBe(false);
  });
  test('> 90 graphemes cut at word boundary with …', () => {
    const t = ogTitle('ord '.repeat(40));
    expect(textLength(t.text)).toBeLessThanOrEqual(90);
    expect(t.text.endsWith('ord…')).toBe(true);
  });
  test('never splits an emoji/ZWJ grapheme', () => {
    const fam = '👨‍👩‍👧‍👦';
    const t = ogTitle(fam.repeat(120));
    expect(textLength(t.text)).toBe(90);
    expect(t.text).toBe(fam.repeat(89) + '…');
  });
  test('control chars/newlines collapsed; markup kept literally (text-only render)', () => {
    expect(ogTitle(' <b>x</b>\n\t\u0000y ').text).toBe('<b>x</b> y');
  });
  test('labels', () => {
    expect(countLabel(1)).toBe('1 datoforslag');
    expect(countLabel(5)).toBe('5 datoforslag');
    expect(ogImagePath('abc')).toBe('/en/p/abc/opengraph-image');
    expect(ogImagePath('abc', 'da')).toBe('/da/p/abc/opengraph-image');
  });
});
